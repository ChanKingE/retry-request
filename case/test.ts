import { createHttpClient, createMockPlugin } from "../src/index.ts";

const client = createHttpClient({
  baseURL: "https://api.example.com",
  timeout: 5_000,
  withCredentials: true,
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
          data: [
            {
              id: "Route000210",
            },
            {
              id: "Route000211",
            },
          ],
        },
      },
    ],
  }),
);
client.interceptors.request.use(async (config) => {
  await new Promise((resolve) => {
    console.log("加载中...");
    setTimeout(resolve, 500);
  });
  return config;
});
client.interceptors.request.use(async (config) => {
  await new Promise((resolve) => {
    console.log("加载完成...");
    setTimeout(resolve, 200);
  });
  return config;
});
async function run() {
  const baseURL = "/api";
  const url = "/hello";
  //  ?commsTest=XC0515
  const response = await client.request<{ data: unknown }, { data: unknown; query: unknown }>({
    url,
    baseURL,
    method: "POST",
    params: {
      query: "queryValue",
    },
    data: {
      data: "dataValue",
    },
    headers: {
      authorization: "",
    },
    retry: 3,
  });
  console.log(response);
}
void run();
