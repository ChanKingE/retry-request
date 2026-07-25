import { createHttpClient, createMockPlugin, createLoggerPlugin } from "../src/index.ts";

const client = createHttpClient({
  baseURL: "https://api.example.com",
  timeout: 5_000,
  withCredentials: true,
  headers: { "x-client-version": "1.0.0" },
  meta: { application: "request-demo", environment: "local" },
});
client.use(
  createMockPlugin({
    delay: 0,
    routes: [
      {
        url: /.*\/api/,
        response: {
          code: 0,
          message: "你好",
          data: [],
        },
      },
    ],
  }),
);
client.use(createLoggerPlugin());

async function run() {
  const baseURL = "http://192.168.210.160:3001";
  const url = "/WebAppServer/Config/Page/Detail";
  //  ?commsTest=XC0515
  client.request({
    url,
    baseURL,
    method: "POST",
    params: {
      commsTest: "XC0515",
    },
    data: {
      id: "Route000210",
    },
    headers: {
      authorization: "",
    },
    retry: 3,
  });
}

void run();
