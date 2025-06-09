import type { NextConfig } from 'next'
import type { Configuration } from 'webpack'

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config: Configuration) => {
    config.resolve = config.resolve || {}
    config.resolve.fallback = { fs: false, path: false }
    return config
  },
}

export default nextConfig
