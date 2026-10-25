import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = new URL('../', import.meta.url);
export function generateGuides(check = false) {
  const manifest = JSON.parse(readFileSync(new URL('docs/configuration/manifest.json', ROOT), 'utf8'));
  const documents = manifest.documents.map(doc => ({ ...doc, content: readFileSync(new URL(doc.path, ROOT), 'utf8').replace(/\r\n/g, '\n').trim() }));
  const raw = 'https://raw.githubusercontent.com/4586j/aichat/main/';
  const index = `# 栖忆配置指南\n\n> 本地单用户 AI 对话应用的配置参考，适用于 ${manifest.appVersion}；文档修订 ${manifest.revision}。\n\n模型连接、表情包、音乐和邮件均在应用设置中填写。凭据由使用者自己输入，本文档不包含真实密码。\n\n## 配置文档\n\n${documents.map(doc => `- [${doc.title}](${raw}${doc.path}): ${doc.keywords.join('、')}`).join('\n')}\n\n## 读取方式\n\n- [完整机器可读文档包](${raw}docs/configuration/guide-bundle.json): 与上述 Markdown 同步生成，含正文、标题、适用版本与修订号。\n\n具备网页读取工具的 AI 可按需跟随链接；普通聊天模型不会自动访问这些 URL，需要应用先检索并提供相关正文。此索引不授予修改设置、测试服务或发信的权限。\n`;
  const files = [['docs/configuration/guide-bundle.json', JSON.stringify({ ...manifest, documents }, null, 2) + '\n'], ['llms.txt', index]];
  for (const [path, content] of files) {
    if (check) {
      if (readFileSync(new URL(path, ROOT), 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error(`${path} 已过期，请运行 npm run docs:build。`);
    } else writeFileSync(new URL(path, ROOT), content);
  }
  return { documentCount: documents.length, revision: manifest.revision };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(generateGuides(process.argv.includes('--check'))));
