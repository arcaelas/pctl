export default class Self extends Function {
    constructor(parsed: any) {
        super();
        return function self(key: string, fallback?: any) {
            const parts = key.split('.');
            let value: any = parsed;
            for (const p of parts) {
                value = value?.[p];
                if (value === undefined) return fallback ?? null;
            }
            return value;
        };
    }
}
