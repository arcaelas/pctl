export default class Env extends Function {
    constructor(_parsed: any) {
        super();
        return function env(key: string, fallback?: any) {
            return key in process.env ? process.env[key] : fallback ?? null;
        };
    }
}
