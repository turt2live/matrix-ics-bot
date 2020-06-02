import * as config from "config";

interface IConfig {
    homeserverUrl: string;
    accessToken: string;
    autoJoin: boolean;
    dataPath: string;
    permissionCheck: {
        roomReminders: string;
    };
}

export default <IConfig>config;
