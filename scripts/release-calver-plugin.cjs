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
			const parts = latestVersion.split('.')
			if (parts.length === 4) {
				const tagDate = `${parts[0]}.${parts[1]}.${parts[2]}`
				if (tagDate === todayPrefix) {
					return `${todayPrefix}.${parseInt(parts[3], 10) + 1}`
				}
			}
		}

		return `${todayPrefix}.0`
	}
}

module.exports = CalVerPlugin
