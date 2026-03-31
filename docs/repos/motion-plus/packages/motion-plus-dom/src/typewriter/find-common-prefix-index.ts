export function findCommonPrefixIndex(current: string, target: string) {
    const commonPrefixLength = Math.min(current.length, target.length)

    let prefixLength = 0
    for (let i = 0; i < commonPrefixLength; i++) {
        if (current[i] === target[i]) {
            prefixLength = i + 1
        } else {
            break
        }
    }

    return prefixLength
}
