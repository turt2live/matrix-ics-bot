# matrix-ics-bot

A bot which primarily deals with recurring reminders in a complicated way. Ideal if you want to
do something with a complicated not-cron schedule.

Help: [#matrix-ics-bot:t2bot.io](https://matrix.to/#/#matrix-ics-bot:t2bot.io)

## Running / Building

Run `yarn install` to get the dependencies.

To build it: `yarn build`.

To run it: `yarn start:dev`

To check the lint: `yarn lint`

### Configuration

This bot uses a package called `config` to manage configuration. The default configuration is offered
as `config/default.yaml`. Copy/paste this to `config/development.yaml` and `config/production.yaml` and edit
them accordingly for your environment.
