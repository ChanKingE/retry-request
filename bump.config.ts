import { defineConfig } from "bumpp";

export default defineConfig({
  // ---------- 核心流程 ----------
  // 交互式询问版本类型 (major/minor/patch/prerelease)
  release: "prompt",
  // 预发布标识符，当选择 prerelease 时生效
  preid: "beta",
  // 自动提交，并指定自定义提交信息格式
  commit: "chore(release): v%s",
  // 自动打标签，并指定标签前缀
  tag: "v%s",
  // 自动推送到远程
  push: false,

  // ---------- 安全与检查 ----------
  // 执行前要求用户确认，防止误操作
  confirm: true,
  // 确保工作区是干净的 (没有未提交的更改)
  noGitCheck: false, // 注意: false 表示会进行检查
  // 不跳过 Git hooks，确保代码质量检查通过
  noVerify: false,

  // ---------- 文件与依赖 ----------
  // 指定需要更新的文件
  files: ["package.json", "bun.lock"],
  // files 中已包含 bun.lock，无需再跑 install
  install: false,
  // 提交时只包含版本更新的文件，不包含其他无关变更
  all: false,

  // ---------- 扩展功能 ----------
  // 构建由 npm publish 的 prepublishOnly 负责，这里不用重复执行
  // execute: "vp run build",
  // 在控制台打印自上次发布以来的提交记录，方便回顾变更
  printCommits: true,
  // 如果是 Monorepo 项目，开启递归更新
  recursive: false, // 非 Monorepo 保持关闭
});
