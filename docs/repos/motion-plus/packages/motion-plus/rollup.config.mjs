import resolve from "@rollup/plugin-node-resolve"
import replace from "@rollup/plugin-replace"
import typescript from "@rollup/plugin-typescript"
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

const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  "motion/react",
  "react/jsx-runtime",
]

// Function to exclude all node_modules
const isExternal = (id) => {
  // Check if it's in our external list
  if (external.some(ext => id === ext || id.startsWith(ext + '/'))) {
    return true
  }
  // Exclude anything from node_modules
  if (id.includes('node_modules')) {
    return true
  }
  return false
}

const es = Object.assign({}, {
  input: ["lib/index.js", "lib/react-entry.js"],
  output: {
      entryFileNames: "[name].mjs",
      format: "es",
      exports: "named",
      preserveModules: true,
      preserveModulesRoot: "lib",
      dir: "dist/es",
  },
  plugins: [resolve(), replaceSettings(), preserveDirectives()],
  external: isExternal,
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
    external: isExternal,
    onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
            return
        }
        warn(warning)
    }
})

const cjsReact = Object.assign({}, cjs, {
    input: "lib/react-entry.js"
})

const cjsAnimateActivity = Object.assign({}, cjs, {
    input: "lib/components/AnimateActivity/index.js",
    output: {
        ...cjs.output,
        entryFileNames: "animate-activity.js",
    }
})

const esAnimateActivity = Object.assign({}, es, {
    input: "lib/components/AnimateActivity/index.js",
    output: {
        ...es.output,
        entryFileNames: "animate-activity.mjs",
    }
})

const cjsAnimateLayout = Object.assign({}, cjs, {
    input: "lib/functions/animate-layout.js",
    output: {
        ...cjs.output,
        entryFileNames: "animate-layout.js",
    }
})

const esAnimateLayout = Object.assign({}, es, {
    input: "lib/functions/animate-layout.js",
    output: {
        ...es.output,
        entryFileNames: "animate-layout.mjs",
    }
})

const cjsAnimateView = Object.assign({}, cjs, {
    input: "lib/components/AnimateView/index.js",
    output: {
        ...cjs.output,
        entryFileNames: "animate-view.js",
    }
})

const esAnimateView = Object.assign({}, es, {
    input: "lib/components/AnimateView/index.js",
    output: {
        ...es.output,
        entryFileNames: "animate-view.mjs",
    }
})

const tickerFramerBase = Object.assign({}, {
  input: ["src/components/Ticker/framer-entry.ts"],
  output: {
      entryFileNames: "Ticker.tsx",
      format: "es",
      exports: "named",
      preserveModules: false,
      dir: "dist/framer",
  },
  jsx: {
      mode: "preserve",
  },
  plugins: [
      typescript({
          compilerOptions: {
              declaration: false,
              jsx: "preserve",
              outDir: undefined,
              target: 'es2020',
              module: 'esnext',
              declarationDir: undefined,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
              skipLibCheck: true
          }
      }),
      replaceSettings("production", true)
  ],
  external: ["motion/react", "framer-motion", "react", "react/jsx-runtime", "react-dom", "motion-utils", "motion-dom"],
  onwarn(warning, warn) {
      if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return
      }
      warn(warning)
  }
})

const animateNumberFramerBase = {
  ...tickerFramerBase,
  input: ["src/components/AnimateNumber/framer-entry.ts"],
  output: {
      ...tickerFramerBase.output,
      entryFileNames: "AnimateNumber.tsx",
  },
}

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
const typesReact = createTypes("types/react-entry.d.ts", "dist/react-entry.d.ts")
const typesAnimateActivity = createTypes("types/components/AnimateActivity/index.d.ts", "dist/animate-activity.d.ts")
const typesAnimateLayout = createTypes("types/functions/animate-layout.d.ts", "dist/animate-layout.d.ts")
const typesAnimateView = createTypes("types/components/AnimateView/index.d.ts", "dist/animate-view.d.ts")

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
    external: external.filter(dep => dep !== "motion-plus-dom"),
    onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
            return
        }
        warn(warning)
    },
})

const sizeAnimateNumber = createSizeBundle("lib/components/AnimateNumber/index.js", "dist/size.animate-number.js")
const sizeAnimateLayout = createSizeBundle("lib/functions/animate-layout.js", "dist/size.animate-layout.js")
const sizeCursor = createSizeBundle("lib/components/Cursor/index.js", "dist/size.cursor.js")
const sizeTicker = createSizeBundle("lib/components/Ticker/index.js", "dist/size.ticker.js")
const sizeTypewriter = createSizeBundle("lib/components/Typewriter/index.js", "dist/size.typewriter.js")
const sizeScrambleText = createSizeBundle("lib/components/ScrambleText/index.js", "dist/size.scramble-text.js")
const sizeCarousel = createSizeBundle("lib/components/Carousel/index.js", "dist/size.carousel.js")
const createSizeBundleWithMotion = (input, file) => Object.assign({}, createSizeBundle(input, file), {
    external: external.filter(dep => dep !== "motion-plus-dom" && dep !== "motion-dom" && dep !== "motion-utils"),
})

const sizeAnimateView = createSizeBundleWithMotion("lib/components/AnimateView/index.js", "dist/size.animate-view.js")

export default [es, esAnimateActivity, esAnimateLayout, esAnimateView, cjs, cjsReact, cjsAnimateActivity, cjsAnimateLayout, cjsAnimateView, types, typesReact, typesAnimateActivity, typesAnimateLayout, typesAnimateView, tickerFramerBase, animateNumberFramerBase, sizeAnimateNumber, sizeAnimateLayout, sizeCursor, sizeTicker, sizeTypewriter, sizeScrambleText, sizeCarousel, sizeAnimateView]
