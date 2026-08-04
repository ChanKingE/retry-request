import { createHttpClient, createMockPlugin } from "../src/index.ts";

const client = createHttpClient({
  baseURL: "https://api.example.com",
  timeout: 5_000,
  withCredentials: true,
  headers: { "x-client-version": "1.0.0" },
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

async function run() {
  const baseURL = "/api";
  const url = "/hello";
  //  ?commsTest=XC0515
  void client.request<{ data: unknown }, { data: unknown; query: unknown }>({
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
}

void run();
