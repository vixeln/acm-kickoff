import { networkInterfaces } from 'node:os'

function isPrivateIPv4(address: string) {
  const octets = address.split('.').map(Number)

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

/** Returns unique LAN URLs ordered by their likelihood of being reachable by another device. */
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
