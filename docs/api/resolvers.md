# Resolvers API

## Resolver Interface

A resolver is a class that extends `Function`. The constructor receives the parsed config object and must return a **named function**.

```typescript
class MyResolver extends Function {
    constructor(parsed: Parsed) {
        super();
        return function myresolver(key: string, fallback?: any): any | Promise<any> {
            // Resolve logic
        };
    }
}
```

The function name becomes the resolver identifier. A function named `myresolver` is invoked with `${myresolver:key}`.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `key` | `string` | The lookup key from `${name:key}`. |
| `fallback` | `any` | Optional fallback from `${name:key, fallback}`. |

### Return Value

- `string` -- Replaces the expression in the containing string.
- `Promise<string>` -- Async resolution. The walk function awaits it.
- `any` (non-string) -- When the expression is the entire string value, replaces the string directly. When embedded in a larger string, stored as an internal reference.
- `null` -- Returned when the key is not found and no fallback is provided.

## Registration

Resolvers are loaded in order:

1. Built-in: `Env`, `Ssm`, `Self`, `Cfn`
2. Custom: paths from the `resolver` array in the config

```yaml
resolver:
  - ./resolvers/vault.js
  - ./resolvers/consul.js
```

Each module is `require()`-ed. The default export (or `module.exports`) must be a class. An instance is created with `new ResolverClass(parsed)`.

Duplicate names throw an error:

```
Error: Resolver "env" already registered
```

## Built-in Resolvers

### env

```typescript
class Env extends Function {
    constructor(_parsed: any) {
        super();
        return function env(key: string, fallback?: any) {
            return key in process.env ? process.env[key] : fallback ?? null;
        };
    }
}
```

| Parameter | Description |
|---|---|
| `key` | Environment variable name. |
| `fallback` | Returned when the variable is not set. Defaults to `null`. |

### ssm

```typescript
class Ssm extends Function {
    constructor(_parsed: any) {
        super();
        const client = new SSMClient({ region: process.env.AWS_REGION });
        const cache = new Map<string, string | null>();
        return function ssm(key: string, fallback?: any) {
            // GetParameterCommand with WithDecryption: true
            // Cached per key. Returns fallback on error.
        };
    }
}
```

| Parameter | Description |
|---|---|
| `key` | SSM parameter name (e.g. `/prod/db-host`). |
| `fallback` | Returned when the parameter is not found or the call fails. Defaults to `null`. |

Requires `AWS_REGION` environment variable. Decrypts SecureString parameters. Caches results per key within the execution.

### self

```typescript
class Self extends Function {
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
```

| Parameter | Description |
|---|---|
| `key` | Dot-notation path into the parsed config (e.g. `custom.region`, `name`). |
| `fallback` | Returned when any path segment is `undefined`. Defaults to `null`. |

### cfn

```typescript
class Cfn extends Function {
    constructor(_parsed: any) {
        super();
        const client = new CloudFormationClient({ region: process.env.AWS_REGION });
        const cache = new Map<string, any>();
        // ...
        return function cfn(key: string, fallback?: any) {
            const dot = key.indexOf('.');
            if (dot === -1) return getExport(key);      // CloudFormation export
            return getOutput(key.slice(0, dot), key.slice(dot + 1));  // Stack output
        };
    }
}
```

| Parameter | Description |
|---|---|
| `key` | Export name (no dot) or `StackName.OutputKey` (with dot). |
| `fallback` | Returned when the export/output is not found. Defaults to `null`. |

**Export lookup**: Calls `ListExports`, paginates until found, caches all exports.

**Output lookup**: Calls `DescribeStacks`, caches all outputs for the stack.

## Walk Algorithm

The resolve plugin processes strings recursively:

1. Match the regex `/\$\{([^:}]+):([^{}]*)}/` to find the outermost expression.
2. Look up the resolver by name.
3. Split args by `,` and trim. Map each arg through the reference cache.
4. Call the resolver with `(key, fallback)`.
5. If the expression is the entire string and the result is non-string, return directly.
6. If the result is non-string within a larger string, store as `__pctl_{uid}__` and replace.
7. If the result is a string, replace inline.
8. Repeat until no more matches.
9. Recurse into arrays and object values.

This enables nesting: `${ssm:${env:PATH_VAR}}` resolves `env:PATH_VAR` first (innermost match), then resolves the outer `ssm:` expression.
