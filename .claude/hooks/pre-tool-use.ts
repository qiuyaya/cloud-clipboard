#!/usr/bin/env bun

const input = await Bun.stdin.text();
const toolCall = JSON.parse(input);

if (toolCall.tool_name === "Bash") {
  const command: string = toolCall.tool_input?.command || "";

  if (/\bgit\s+push\b/.test(command)) {
    console.error(
      "⚠️ 检测到 git push 命令。请确认用户是否明确要求了推送操作，如果不是，必须先询问用户。",
    );
  }

  if (
    /\b(bun|npm|yarn|pnpm)\s+run\s+release\b/.test(command) ||
    /\bnode\s+scripts\/release\.js\b/.test(command)
  ) {
    console.error(
      "⚠️ 检测到 release 命令。请确认用户是否明确要求了发布版本，如果不是，必须先询问用户。",
    );
  }
}

process.exit(0);
