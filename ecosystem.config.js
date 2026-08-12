module.exports = {
  apps: [
    {
      name: "hoh-signature-api",
      script: "server.js",
      env: {
        PORT: 3004,
        API_KEY: "harambedidnothingwrong",
        BASE_URL: "https://ai.myhoh.in/email-sign",
      },
    },
  ],
};
