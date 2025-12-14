/** @typedef { import('next').NextConfig } NextConfig */

/** @type { NextConfig } */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputStandalone: true,
  },
  // Mark ioredis as external for server-side only
  serverComponentsExternalPackages: ['ioredis'],
  webpack: (config, { isServer }) => {
    // Fix for Node.js 24 compatibility
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    } else {
      // Exclude Node.js modules from client bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        crypto: false,
      };
      
      // Exclude ioredis from client bundle - use alias to prevent bundling
      config.resolve.alias = {
        ...config.resolve.alias,
        'ioredis': false,
      };
      
      // Also add to externals to prevent webpack from trying to bundle it
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('ioredis');
      }
    }
    return config;
  },
  async headers() {
    return [
        {
          //
            source: "/manifest.json",
            headers: [
              {
                key: "Access-Control-Allow-Origin",
                value: 'https://app.safe.global',
              },
              {
                key: "Access-Control-Allow-Methods",
                value: 'GET',
              },
              {
                key: "Access-Control-Allow-Headers",
                value: 'X-Requested-With, content-type, Authorization',
              },
            ]
        },
        {
          // matching all API routes
          source: "/api/:path*",
          headers: [
              { key: "Access-Control-Allow-Credentials", value: "true" },
              { key: "Access-Control-Allow-Origin", value: "*" },
              { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
              { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
          ]
      }
    ]
}
};

module.exports = nextConfig;
