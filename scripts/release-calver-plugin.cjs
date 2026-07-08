const { Plugin } = require('release-it')

const { computeCalverVersion } = require('./release-utils.cjs')

class CalVerPlugin extends Plugin {
	static disablePlugin() {
		return ['version']
	}

	getIncrement() {
		return 'calver'
	}

	getIncrementedVersionCI({ latestVersion }) {
		return computeCalverVersion(latestVersion)
	}

	getIncrementedVersion({ latestVersion }) {
		return computeCalverVersion(latestVersion)
	}
}

module.exports = CalVerPlugin
