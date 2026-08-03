module.exports = {
  apps: [
    {
      name: "hoh-signature-api",
      script: "server.js",
      env: {
        PORT: 3000,
        API_KEY: "change-me-to-a-long-random-string",
        BASE_URL: "http://your-vm-ip-or-domain:3000",
      },
    },
  ],
};
