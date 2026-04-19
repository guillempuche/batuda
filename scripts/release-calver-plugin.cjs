const { Plugin } = require('release-it')

class CalVerPlugin extends Plugin {
	static disablePlugin() {
		return ['version']
	}

	getIncrement() {
		return 'calver'
	}

	getIncrementedVersionCI({ latestVersion }) {
		return this._computeNextVersion(latestVersion)
	}

	getIncrementedVersion({ latestVersion }) {
		return this._computeNextVersion(latestVersion)
	}

	_computeNextVersion(latestVersion) {
		const now = new Date()
		const year = now.getFullYear()
		const month = now.getMonth() + 1
		const day = now.getDate()
		const todayPrefix = `${year}.${month}.${day}`

		if (latestVersion) {
			// Accept "YYYY.M.D" or "YYYY.M.D-N". Same-day bumps use the -N
			// prerelease suffix so the base remains valid 3-segment SemVer,
			// which is what pnpm's workspace resolver requires.
			const match = latestVersion.match(/^(\d+\.\d+\.\d+)(?:-(\d+))?$/)
			if (match && match[1] === todayPrefix) {
				const n = match[2] === undefined ? 1 : parseInt(match[2], 10) + 1
				return `${todayPrefix}-${n}`
			}
		}

		return todayPrefix
	}
}

module.exports = CalVerPlugin
