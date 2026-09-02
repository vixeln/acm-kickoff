import { networkInterfaces } from 'node:os'

/** Reports whether an IPv4 address belongs to one of the RFC 1918 private ranges. */
function isPrivateIPv4(address: string) {
  const octets = address.split('.').map(Number)

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

/**
 * Builds LAN URLs ordered by their likelihood of being reachable from another device.
 *
 * Private addresses are preferred over other non-loopback addresses, then common physical
 * adapter names are preferred over VPN and virtual interfaces. Multiple URLs are retained as a
 * fallback because a machine can legitimately have more than one usable network connection.
 */
export function getLanUrls(port: number, path = '') {
  const addresses = Object.entries(networkInterfaces())
    .flatMap(([interfaceName, entries]) =>
      (entries ?? []).map((entry) => ({ interfaceName, ...entry })),
    )
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .sort((a, b) => {
      const privateDifference = Number(isPrivateIPv4(b.address)) - Number(isPrivateIPv4(a.address))
      if (privateDifference !== 0) return privateDifference

      // Physical Wi-Fi/Ethernet interfaces are generally more useful than VPN adapters.
      const preferred = /^(en|eth|wlan)/
      return Number(preferred.test(b.interfaceName)) - Number(preferred.test(a.interfaceName))
    })

  return [...new Set(addresses.map(({ address }) => `http://${address}:${port}${path}`))]
}
