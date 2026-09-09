module.exports = {
  apps: [
    {
      name: "hoh-signature-api",
      script: "server.js",
      env: {
        PORT: 3004,
        BASE_URL: "http://165.99.128.167/email-sign",
        BIOSTAR_SERVER_IP: "185.15.209.134:5002",
        BIOSTAR_USERNAME: "create_add_users",
        BIOSTAR_PASSWORD: "Test@2026",
        BIOSTAR_USER_GROUP_ID: "3440",
        BIOSTAR_ACCESS_GROUP_ID: "2",
        DARWINBOX_API_KEY:
          "a785859c3f7a244bf281e706fe9d07ce62c0db2d763a934bc68df13b4e448b2a6f1356664ac22bae5a365b3eade406edd22ed73f6cf5c3d3908b79dfbc72c057",
        DARWINBOX_USERNAME: "srushy",
        DARWINBOX_PASSWORD: "Password@27",
      },
    },
  ],
};
