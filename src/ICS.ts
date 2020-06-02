import "@rschedule/moment-tz-date-adapter/setup";
import { MatrixClient } from "matrix-bot-sdk";
import { VEvent } from "@rschedule/ical-tools";
import moment, { Moment } from "moment";

export class ICS {

    private vevent: VEvent;
    private icsSubject: string;

    public constructor(private mxcUriOrRaw: string, private client: MatrixClient) {
    }

    public get subject(): string {
        return this.icsSubject;
    }

    public get nextEvent(): Moment | null {
        return this.vevent.occurrences({start: moment.tz(), take: 1}).toArray()[0].date || null;
    }

    public get nextNextEvent(): Moment | null {
        return this.vevent.occurrences({start: moment.tz().add(1, 'minute'), take: 1}).toArray()[0].date || null;
    }

    public async parse() {
        let text = this.mxcUriOrRaw;
        if (this.mxcUriOrRaw.startsWith("mxc://")) {
            const media = await this.client.downloadContent(this.mxcUriOrRaw);
            text = media.data.toString('utf-8');
        }

        const lines = text.replace(/\r/gm, '').split('\n');

        // Strip the lines down to just the VEvent info
        const rawVEvent = lines.reduce((prev, curr) => {
            if (curr.trim().toUpperCase() === "BEGIN:VEVENT") {
                prev.includeNextLine = true;
            }
            if (prev.includeNextLine) {
                if (curr.trim().toUpperCase() === "END:VEVENT") {
                    prev.includeNextLine = false;
                }
                prev.veventStr += curr + "\n";
            }
            return prev;
        }, {includeNextLine: false, veventStr: ""}).veventStr;

        this.vevent = VEvent.fromICal(rawVEvent)[0];

        const subj = "SUMMARY:";
        this.icsSubject = ((rawVEvent.split('\n').find(i => i.startsWith(subj))) || subj).substring(subj.length);
    }

    public toString(): string {
        return this.vevent.toICal();
    }
}
