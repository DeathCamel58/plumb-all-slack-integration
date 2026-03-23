/**
 * Quick script to fetch raw Slack messages from the call-logs channel
 * and test the parseCallRailMessage regex against them.
 *
 * Usage: node scripts/inspect-callrail-messages.mjs
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env_development" });

import Slack from "@slack/bolt";

const app = new Slack.App({
  signingSecret: process.env.SLACK_SIGNING_SECRET || "",
  token: process.env.SLACK_TOKEN || "",
});

// Resolve channel name to ID
async function resolveChannelId(name) {
  if (/^[CGD][A-Z0-9]{8,}$/.test(name)) return name;
  const result = await app.client.conversations.list();
  const ch = result.channels.find((c) => c.name === name);
  return ch ? ch.id : null;
}

function parseCallRailMessage(text, blocks) {
  if (!text) return null;

  let callMatch = text.match(/\*New Call\*/);
  if (callMatch) {
    let fromMatch = text.match(/From:\s*\*([^*]*)\*\s*(\+?\d+)/);
    let toMatch = text.match(/To:\s*\*(?:<[^|]*\|)?([^*>]*)>?\*\s*(\+?\d+)/);
    return {
      type: "CallRail Call",
      name: fromMatch ? fromMatch[1].trim() : null,
      phone: fromMatch ? fromMatch[2].trim() : null,
      source: toMatch ? toMatch[1].trim() : null,
      message: null,
    };
  }

  let smsMatch = text.match(/\*Text Message Received\*/);
  if (smsMatch) {
    let fromMatch = text.match(/From:\s*\*(?:<[^|]*\|)?(\+?\d+)>?\*/);
    let toMatch = text.match(/To:\s*\*(?:<[^|]*\|)?([^*>]*)>?\*/);

    let smsMessage = null;
    if (blocks && blocks.length > 1) {
      let contentBlock = blocks[1]?.text?.text || "";
      let msgMatch = contentBlock.match(/\*Message Content:\*\n&gt;\s*(.*)/s);
      if (msgMatch) {
        smsMessage = msgMatch[1].trim();
      }
    }

    return {
      type: "CallRail SMS",
      name: null,
      phone: fromMatch ? fromMatch[1].trim() : null,
      source: toMatch ? toMatch[1].trim() : null,
      message: smsMessage,
    };
  }

  return null;
}

async function main() {
  await app.start(0); // Start without listening

  const channelName = process.env.SLACK_CALL_LOGS || "call-logs";
  const channelId = await resolveChannelId(channelName);
  if (!channelId) {
    console.error(`Could not resolve channel: ${channelName}`);
    process.exit(1);
  }
  console.log(`Channel: ${channelName} → ${channelId}\n`);

  const result = await app.client.conversations.history({
    channel: channelId,
    limit: 10,
  });

  for (const msg of result.messages) {
    console.log("=".repeat(80));
    console.log("RAW TEXT:");
    console.log(msg.text);
    console.log("\nBLOCKS:", JSON.stringify(msg.blocks?.slice(0, 2), null, 2));
    console.log("\nATTACHMENTS:", JSON.stringify(msg.attachments?.slice(0, 2), null, 2));
    console.log("\nPARSED:", parseCallRailMessage(msg.text, msg.blocks));
    console.log("");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
