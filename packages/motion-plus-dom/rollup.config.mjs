import resolve from "@rollup/plugin-node-resolve"
import replace from "@rollup/plugin-replace"
import dts from "rollup-plugin-dts"
import preserveDirectives from "rollup-plugin-preserve-directives"
import terser from "@rollup/plugin-terser"
import pkg from "./package.json" with { type: "json" }
import tsconfig from "./tsconfig.json" with { type: "json" }

const replaceSettings = (env, useFramerMotion) => {
  const replaceConfig = env
      ? {
            "process.env.NODE_ENV": JSON.stringify(env),
            preventAssignment: false,
        }
      : {
            preventAssignment: false,
        }

  replaceConfig.__VERSION__ = `${pkg.version}`

  if (useFramerMotion) {
    replaceConfig["motion/react"] = "framer-motion"
  }

  return replace(replaceConfig)
}

const pureClass = {
    transform(code) {
        // Replace TS emitted @class function annotations with PURE so terser
        // can remove them
        return code.replace(/\/\*\* @class \*\//g, "/*@__PURE__*/")
    },
}

const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  "motion/react",
  "react/jsx-runtime",
]

const es = Object.assign({}, {
  input: ["lib/index.js"],
  output: {
      entryFileNames: "[name].mjs",
      format: "es",
      exports: "named",
      preserveModules: true,
      dir: "dist/es",
  },
  plugins: [resolve(), replaceSettings(), preserveDirectives()],
  external,
  onwarn(warning, warn) {
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return
      }
      warn(warning)
  }
})

const createSizeBundle = (input, file) => Object.assign({}, es, {
    input,
    output: Object.assign({}, es.output, {
        file,
        preserveModules: false,
        dir: undefined,
    }),
    plugins: [
        resolve(),
        replaceSettings("production"),
        terser({ output: { comments: false } }),
    ],
    external,
    onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
            return
        }
        warn(warning)
    },
})

const sizeSplitText = createSizeBundle("lib/split-text/index.js", "dist/size.split-text.js")
const sizeScrambleText = createSizeBundle("lib/scramble-text/index.js", "dist/size.scramble-text.js")

const umd = {
    input: "lib/index.js",
    output: {
        file: `dist/${pkg.name}.dev.js`,
        format: "umd",
        name: "MotionPlus",
        exports: "named",
        globals: { motion: "Motion", "motion-dom": "Motion", "motion-utils": "Motion" },
    },
    external: ["motion", "motion-dom", "motion-utils"],
    plugins: [resolve(), replaceSettings("development")],
    onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
            return
        }
        warn(warning)
    }
}

const umdProd = Object.assign({}, umd, {
    output: Object.assign({}, umd.output, {
        file: `dist/${pkg.name}.js`,
    }),
    plugins: [
        resolve(),
        replaceSettings("production"),
        pureClass,
        terser({ output: { comments: false } }),
    ],
    onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
            return
        }
        warn(warning)
    }
})

const cjs = Object.assign({}, {
    input: "lib/index.js",
    output: {
        entryFileNames: `[name].js`,
        dir: "dist/cjs",
        format: "cjs",
        exports: "named",
        esModule: true
    },
    plugins: [resolve(), replaceSettings()],
    external,
    onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
            return
        }
        warn(warning)
    }
})

// const cjsM = {...cjs, input: "lib/m.js"}

const typePlugins = [
    dts({ compilerOptions: { ...tsconfig, baseUrl: "types" } }),
]

function createTypes(input, file) {
    return {
        input,
        output: {
            format: "es",
            file: file,
        },
        plugins: typePlugins,
    }
}

const types = createTypes("types/index.d.ts", "dist/index.d.ts")
// const typesM = createTypes("types/m.d.ts", "dist/m.d.ts")

export default [umd, umdProd, es, sizeSplitText, sizeScrambleText, cjs, types]
