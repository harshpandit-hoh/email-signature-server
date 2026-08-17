module.exports = {
  apps: [
    {
      name: "hoh-signature-api",
      script: "server.js",
      env: {
        PORT: 3004,
        API_KEY: "harambedidnothingwrong",
        BASE_URL: "https://ai.myhoh.in/email-sign",
        BIOSTAR_SERVER_IP: "185.15.209.134:5002",
        BIOSTAR_USERNAME: "create_add_users",
        BIOSTAR_PASSWORD: "Test@2026",
        BIOSTAR_USER_GROUP_ID: "3440",
        BIOSTAR_ACCESS_GROUP_ID: "2",
      },
    },
  ],
};
