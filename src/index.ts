import "moment-timezone";
import {
    AutojoinRoomsMixin,
    LogLevel,
    LogService,
    MatrixClient,
    RichConsoleLogger,
    RichReply,
    SimpleFsStorageProvider
} from "matrix-bot-sdk";
import * as path from "path";
import config from "./config";
import { ICS } from "./ICS";
import { Reminder } from "./Reminder";
import sanitizeHtml from "sanitize-html";

// First things first: let's make the logs a bit prettier.
LogService.setLogger(new RichConsoleLogger());

// For now let's also make sure to log everything (for debugging)
LogService.setLevel(LogLevel.DEBUG);

// Print something so we know the bot is working
LogService.info("index", "Bot starting...");

// Prepare the storage system for the bot
const storage = new SimpleFsStorageProvider(path.join(config.dataPath, "bot.json"));

// Create the client
const client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);

// Setup the autojoin mixin (if enabled)
if (config.autoJoin) {
    AutojoinRoomsMixin.setupOnClient(client);
}

const activeReminders: Reminder[] = [];

function activeNotDeletedReminders(): Reminder[] {
    return activeReminders.filter(r => !r.isDeleted);
}

// This is the startup closure where we give ourselves an async context
(async function () {
    const joinedRooms = await client.getJoinedRooms();
    for (const roomId of joinedRooms) {
        const reminders = await Reminder.createForRoom(roomId, client);
        activeReminders.push(...reminders);
    }

    client.on('room.join', async (roomId: string, ev: any) => {
        const text = `Hello! To create a new reminder for this room, upload an iCalendar (.ics) file here. To see current reminders, say \`!list ${roomId}\``;
        const html = `Hello! To create a new reminder for this room, upload an iCalendar (.ics) file here. To see current reminders, say <code>!list ${roomId}</code>`;
        await client.sendMessage(roomId, {
            body: text,
            formatted_body: html,
            format: "org.matrix.custom.html",
            msgtype: "m.notice",
        });
    });

    async function tryPermissions(roomId: string, ev: any): Promise<boolean> {
        // Check permissions
        const hasPermission = await client.userHasPowerLevelFor(ev['sender'], roomId, config.permissionCheck.roomReminders, true);
        if (!hasPermission) {
            const textReply = "Sorry, you don't have permission to use reminders.";
            const reply = RichReply.createFor(roomId, ev, textReply, textReply);
            reply['msgtype'] = "m.notice";
            await client.sendMessage(roomId, reply);
            return false;
        }
        return true;
    }

    async function previewReminder(roomId: string, reminder: Reminder) {
        await client.sendMessage(roomId, {
            body: reminder.summaryText,
            formatted_body: reminder.summaryHtml,
            format: 'org.matrix.custom.html',
            msgtype: 'm.notice',
            'io.t2bot.ics_reminder.message_kind': 'preview',
            'io.t2bot.ics_reminder.uid': reminder.uid,
            'io.t2bot.ics_reminder.vevent': reminder.ics.toString(),
        });
    }

    client.on('room.message', async (roomId: string, ev: any) => {
        if (ev['type'] !== 'm.room.message') return;
        if (ev['sender'] === await client.getUserId()) return;
        if (!ev['content']) return;
        if (!ev['content']['body']) return;

        const prefixes = ["!edit", "!delete", "!list", "!help"];
        if (prefixes.some(p => ev['content']['body'].startsWith(p))) {
            if (!(await tryPermissions(roomId, ev))) return;
        } else {
            return; // not a command
        }

        try {
            if (ev['content']['body'].startsWith("!edit")) {
                const args = ev['content']['body'].split(' ');
                const targetRoomRef = args[1];
                const uid = args[2];
                const hasText = args[3];
                if (!targetRoomRef || !uid || !hasText) {
                    const text = "Invalid syntax. Try !help for more information.";
                    const reply = RichReply.createFor(roomId, ev, text, text);
                    await client.sendMessage(roomId, {...reply, msgtype: 'm.notice'});
                } else {
                    const targetRoomId = await client.resolveRoom(targetRoomRef);
                    if (!(await tryPermissions(targetRoomId, ev))) return;
                    const commandToRemove = `!edit ${targetRoomRef} ${uid}`;
                    const newText = ev['content']['body'].replace(commandToRemove, '').trim();
                    let newHtml = sanitizeHtml(newText);
                    if (ev['content']['format'] === 'org.matrix.custom.html' && ev['content']['formatted_body']) {
                        newHtml = ev['content']['formatted_body'].replace(commandToRemove, '').trim();
                    }
                    const reminder = activeNotDeletedReminders().find(r => r.roomId === targetRoomId && r.uid === uid);
                    if (!reminder) {
                        const text = "Reminder not found. Try !help for more information";
                        const reply = RichReply.createFor(roomId, ev, text, text);
                        await client.sendMessage(roomId, {...reply, msgtype: 'm.notice'});
                        return;
                    }
                    reminder.summaryText = newText;
                    reminder.summaryHtml = newHtml;
                    await reminder.update();

                    const replyText = "Reminder updated. Preview follows:";
                    const commandReply = RichReply.createFor(roomId, ev, replyText, replyText);
                    await client.sendMessage(roomId, {...commandReply, msgtype: 'm.notice'});
                    await previewReminder(roomId, reminder);
                }
            } else if (ev['content']['body'].startsWith("!list")) {
                const args = ev['content']['body'].split(' ');
                let targetRoomRef = args[1];
                if (!targetRoomRef) {
                    targetRoomRef = roomId;
                }
                const targetRoomId = await client.resolveRoom(targetRoomRef);
                if (!(await tryPermissions(targetRoomId, ev))) return;
                const reminders = activeNotDeletedReminders().filter(r => r.roomId === targetRoomId);
                await client.sendNotice(roomId, `${reminders.length} reminders:`);
                for (const reminder of reminders) {
                    await client.sendMessage(roomId, {
                        body: `Reminder \`${reminder.uid}\`\nNext: ${reminder.ics.nextEvent.fromNow()}`,
                        formatted_body: `Reminder <code>${reminder.uid}</code><br />Next: ${reminder.ics.nextEvent.fromNow()}`,
                        format: 'org.matrix.custom.html',
                        msgtype: 'm.notice',
                    });
                    await previewReminder(roomId, reminder);
                }
                if (!reminders.length) {
                    await client.sendNotice(roomId, "No reminders.");
                }
            } else if (ev['content']['body'].startsWith("!delete")) {
                const args = ev['content']['body'].split(' ');
                const targetRoomRef = args[1];
                const uid = args[2];
                if (!targetRoomRef || !uid) {
                    const text = "Invalid syntax. Try !help for more information.";
                    const reply = RichReply.createFor(roomId, ev, text, text);
                    await client.sendMessage(roomId, {...reply, msgtype: 'm.notice'});
                    return;
                }
                const targetRoomId = await client.resolveRoom(targetRoomRef);
                if (!(await tryPermissions(targetRoomId, ev))) return;
                const reminder = activeNotDeletedReminders().find(r => r.roomId === targetRoomId && r.uid === uid);
                if (!reminder) {
                    const text = "Reminder not found. Try !help for more information";
                    const reply = RichReply.createFor(roomId, ev, text, text);
                    await client.sendMessage(roomId, {...reply, msgtype: 'm.notice'});
                    return;
                }
                await reminder.delete();
                const replyText = "Reminder deleted.";
                const commandReply = RichReply.createFor(roomId, ev, replyText, replyText);
                await client.sendMessage(roomId, {...commandReply, msgtype: 'm.notice'});
            } else if (ev['content']['body'].startsWith('!help')) {
                const text = "Help:\nList reminders: !list <room ID>\nEdit reminder: !edit <room ID> <reminder ID> <new text>\nDelete reminder: !delete <room ID> <reminder ID>";
                const html = "Help:<br />List reminders: <code>!list &lt;room ID&gt;</code><br/>Edit reminder: <code>!edit &lt;room ID&gt; &lt;reminder ID&gt; &lt;new text&gt;</code><br/>Delete reminder: <code>!delete &lt;room ID&gt; &lt;reminder ID&gt;</code>";
                const reply = RichReply.createFor(roomId, ev, text, html);
                await client.sendMessage(roomId, {...reply, msgtype: 'm.notice'});
            }
        } catch (e) {
            LogService.error("index", e);
            const text = "There was an error processing your command";
            const reply = RichReply.createFor(roomId, ev, text, text);
            await client.sendMessage(roomId, {...reply, msgtype: 'm.notice'});
        }
    });

    client.on('room.message', async (roomId: string, ev: any) => {
        if (ev['type'] !== 'm.room.message') return;
        if (ev['sender'] === await client.getUserId()) return;
        if (!ev['content']) return;
        if (!ev['content']['url']) return;
        if (ev['content']['msgtype'] !== 'm.file') return;
        if (!ev['content']['body']) return;

        // It's a file - try and parse it as an ICS
        if (!ev['content']['body'].toLowerCase().endsWith('.ics')) return;

        // Check permissions
        if (!(await tryPermissions(roomId, ev))) return;

        try {
            const ics = new ICS(ev['content']['url'], client);
            await ics.parse();
            const reminder = await Reminder.create(ics, roomId, client);
            activeReminders.push(reminder);
            const textReply = `Created reminder with ID ${reminder.uid} occurring next: ${reminder.ics.nextEvent.fromNow()}\n\nTo edit the text, open a DM with me and say \`!edit ${roomId} ${reminder.uid} <new text here>\`\n\nPreview: ${reminder.summaryText}`;
            const htmlReply = `Created reminder with ID <code>${reminder.uid}</code> occurring next: ${reminder.ics.nextEvent.fromNow()}<br/><br/>To edit the text, open a DM with me and say <code>!edit ${sanitizeHtml(roomId)} ${reminder.uid} &lt;new text here&gt;</code><br /><br />Preview: ${reminder.summaryHtml}`;
            const reply = RichReply.createFor(roomId, ev, textReply, htmlReply);
            reply['msgtype'] = 'm.notice';
            await client.sendMessage(roomId, {
                ...reply,
                'io.t2bot.ics_reminder.message_kind': 'create',
                'io.t2bot.ics_reminder.uid': reminder.uid,
                'io.t2bot.ics_reminder.vevent': reminder.ics.toString(),
            });
        } catch (e) {
            LogService.error("index", "Error parsing possible iCalendar file:", e);
            const textReply = "Sorry, that does not look like a valid iCalendar file.";
            const reply = RichReply.createFor(roomId, ev, textReply, textReply);
            reply['msgtype'] = 'm.notice';
            await client.sendMessage(roomId, reply);
        }
    });

    // Try and trigger all reminders every 1 second
    setInterval(() => {
        // do this with map to keep them all async
        activeReminders.forEach(r => r.tryTrigger());
    }, 1000);

    LogService.info("index", "Starting sync...");
    await client.start(); // This blocks until the bot is killed
})();
