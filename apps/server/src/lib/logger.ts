import { NodeFileSystem } from '@effect/platform-node'
import { Config, Effect, Layer, Logger, References } from 'effect'

/**
 * Application logger layer.
 *
 * - Development: pretty console + logfmt file (server.log) + tracer
 * - Production:  JSON console + tracer
 *
 * Min log level read from MIN_LOG_LEVEL env var (default: Info).
 */
export const LoggerLive = Layer.unwrap(
	Effect.gen(function* () {
		const env = yield* Config.string('NODE_ENV').pipe(
			Config.withDefault('development'),
		)
		const level = yield* Config.logLevel('MIN_LOG_LEVEL').pipe(
			Config.withDefault('Info'),
		)

		const minLevel = Layer.succeed(References.MinimumLogLevel, level)

		if (env === 'development') {
			return Logger.layer([
				Logger.consolePretty(),
				Logger.tracerLogger,
				Logger.toFile(Logger.formatLogFmt, 'server.log'),
			]).pipe(Layer.provide(NodeFileSystem.layer), Layer.provideMerge(minLevel))
		}

		return Logger.layer([Logger.consoleJson, Logger.tracerLogger]).pipe(
			Layer.provideMerge(minLevel),
		)
	}),
)

/**
 * MCP logger — pretty output routed to stderr (stdout reserved for JSON-RPC).
 */
export const McpLoggerLive = Layer.unwrap(
	Effect.gen(function* () {
		const level = yield* Config.logLevel('MIN_LOG_LEVEL').pipe(
			Config.withDefault('Info'),
		)

		return Logger.layer([
			Logger.consolePretty({ stderr: true }),
			Logger.tracerLogger,
		]).pipe(
			Layer.provideMerge(Layer.succeed(References.MinimumLogLevel, level)),
		)
	}),
)
