import { MatrixClient } from "matrix-bot-sdk";
import { ICS } from "./ICS";
import { v4 as uuidv4 } from "uuid";
import moment from "moment";
import sanitizeHtml from "sanitize-html";

export const REMINDER_INDEX_EVENT = "io.t2bot.ics_reminder.vevents.index";
export const REMINDER_EVENT_PREFIX = "io.t2bot.ics_reminder.vevents.vevent";

export class Reminder {
    private deleted = false;

    private constructor(
        private client: MatrixClient,
        public readonly roomId: string,
        public readonly uid: string,
        public summaryText: string,
        public summaryHtml: string,
        public readonly ics: ICS,
    ) {
    }

    public get isDeleted(): boolean {
        return this.deleted;
    }

    public async tryTrigger() {
        if (this.deleted) return;
        const next = this.ics.nextEvent;
        const today = moment.tz();
        // TODO: Handle missing events
        if (today.diff(next, 'seconds') === 0) {
            await this.client.sendMessage(this.roomId, {
                msgtype: "m.text",
                format: "org.matrix.custom.html",
                formatted_body: this.summaryHtml,
                body: this.summaryText,
                'io.t2bot.ics_reminder.message_kind': 'trigger',
                'io.t2bot.ics_reminder.uid': this.uid,
                'io.t2bot.ics_reminder.vevent': this.ics.toString(),
                'io.t2bot.ics_reminder.next': this.ics.nextNextEvent.unix(),
            });
        }
    }

    public async update() {
        if (this.deleted) return;
        await this.client.setRoomAccountData(`${REMINDER_EVENT_PREFIX}.${this.uid}`, this.roomId, {
            vevent: this.ics.toString(),
            summaryText: this.summaryText,
            summaryHtml: this.summaryHtml,
        });
    }

    public async delete() {
        if (this.deleted) return;
        const index = await this.client.getSafeRoomAccountData(REMINDER_INDEX_EVENT, this.roomId, {});
        delete index[this.uid];
        await this.client.setRoomAccountData(REMINDER_INDEX_EVENT, this.roomId, index);
        this.deleted = true;
    }

    public static async create(ics: ICS, roomId: string, client: MatrixClient): Promise<Reminder> {
        const uid: string = new Buffer(`${roomId}|${uuidv4()}`).toString('base64').replace(/\+\/=/g, '');
        const index = await client.getSafeRoomAccountData(REMINDER_INDEX_EVENT, roomId, {});
        index[uid] = {}; // empty object for now. Not a good idea to use arrays for future overwrite protection.
        await client.setRoomAccountData(REMINDER_INDEX_EVENT, roomId, index);
        const opts = {
            vevent: ics.toString(),
            summaryText: ics.subject,
            summaryHtml: sanitizeHtml(ics.subject),
        };
        await client.setRoomAccountData(`${REMINDER_EVENT_PREFIX}.${uid}`, roomId, opts);
        return new Reminder(client, roomId, uid, opts.summaryText, opts.summaryHtml, ics);
    }

    public static async createForRoom(roomId: string, client: MatrixClient): Promise<Reminder[]> {
        const reminders: Reminder[] = [];
        const index = await client.getSafeRoomAccountData(REMINDER_INDEX_EVENT, roomId, {});
        for (const uid of Object.keys(index)) {
            const opts = await client.getSafeRoomAccountData(`${REMINDER_EVENT_PREFIX}.${uid}`, roomId, {});
            if (opts.vevent) {
                const ics = new ICS(opts.vevent, client);
                await ics.parse();
                reminders.push(new Reminder(client, roomId, uid, opts.summaryText, opts.summaryHtml, ics));
            }
        }
        return reminders;
    }
}
