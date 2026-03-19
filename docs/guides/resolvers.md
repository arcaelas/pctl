# Resolvers

Resolvers process `${name:key, fallback}` patterns in string values throughout the configuration. They run before validation, replacing placeholders with real values from environment variables, AWS SSM, CloudFormation, or the config itself.

## Syntax

```
${resolver_name:key}
${resolver_name:key, fallback}
```

- `resolver_name` -- Identifies the resolver (e.g. `env`, `ssm`, `self`, `cfn`).
- `key` -- The lookup key passed to the resolver.
- `fallback` -- Optional. Returned when the key is not found.

## Built-in Resolvers

### env

Reads from `process.env`.

```yaml
env:
  PORT: "${env:PORT, 3000}"
  NODE_ENV: "${env:NODE_ENV, production}"
  DB_HOST: "${env:DB_HOST}"
```

If the environment variable does not exist and no fallback is provided, the resolver returns `null`.

### ssm

Reads from AWS Systems Manager Parameter Store. Supports encrypted parameters (`WithDecryption: true`). Requires `AWS_REGION` in environment.

```yaml
env:
  DB_URL: "${ssm:/prod/db-url}"
  API_KEY: "${ssm:/prod/api-key, default-key}"
```

Results are cached per parameter name within the same execution. If the parameter is not found or the SSM call fails, the fallback is returned.

### self

Reads from the parsed config object using dot-notation paths.

```yaml
custom:
  region: us-east-1
  cluster: prod

services:
  api:
    env:
      REGION: "${self:custom.region}"
      STACK: "${self:name}"
    provider:
      name: aws
      options:
        cluster: "${self:custom.cluster}"
```

Traverses the parsed config tree: `self:custom.region` resolves `parsed.custom.region`. Returns the fallback when any segment is `undefined`.

### cfn

Reads from AWS CloudFormation exports and stack outputs. Requires `AWS_REGION` in environment.

**Exports** (no dot in the key):

```yaml
env:
  VPC_ID: "${cfn:prod-vpc-id}"
```

Calls `ListExports` and matches by export name. Results are cached.

**Stack outputs** (dot separates stack name and output key):

```yaml
env:
  DB_ENDPOINT: "${cfn:prod-database.Endpoint}"
  LB_DNS: "${cfn:prod-network.LoadBalancerDns, localhost}"
```

Calls `DescribeStacks` for the stack name, then looks up the output key. Cached per stack.

## Nesting

Resolvers can be nested. The innermost expression resolves first:

```yaml
env:
  DB_HOST: "${ssm:${env:SSM_PATH, /prod/db-host}}"
```

Resolution order:

1. `${env:SSM_PATH, /prod/db-host}` resolves to the value of `SSM_PATH` or `/prod/db-host`.
2. `${ssm:/prod/db-host}` resolves the SSM parameter.

## Fallback Chain

Combine nesting with fallbacks for multi-source resolution:

```yaml
env:
  API_KEY: "${ssm:/prod/api-key, ${env:API_KEY, default-key}}"
```

1. Try SSM parameter `/prod/api-key`.
2. If not found, try environment variable `API_KEY`.
3. If not found, use `default-key`.

## Non-String Values

When a resolver returns a non-string value (object, number, boolean) and the expression is the entire string, the value replaces the string directly. When the expression is embedded in a larger string, non-string values are stored in an internal reference map and tracked by a placeholder key.

```yaml
custom:
  ports:
    - 3000
    - 8080

services:
  api:
    ports: "${self:custom.ports}"  # Resolves to [3000, 8080] (array, not string)
```

## Custom Resolvers

A resolver is a class that extends `Function`. The constructor receives the parsed config and must return a named function.

### Structure

```javascript
// resolvers/vault.js
module.exports = class Vault extends Function {
    constructor(parsed) {
        super();
        // Setup: create clients, read config, etc.
        const cache = new Map();

        return function vault(key, fallback) {
            // `key` is the first param after the colon
            // `fallback` is the second param (optional)
            if (cache.has(key)) return cache.get(key);

            // Your logic here. Return a value or a Promise.
            const value = fetchFromVault(key);
            cache.set(key, value);
            return value ?? fallback ?? null;
        };
    }
};
```

The function **name** (`vault` in the example) becomes the resolver identifier used in `${vault:key}`.

### Registration

Add the module path to the `resolver` array in your config:

```yaml
resolver:
  - ./resolvers/vault.js

services:
  api:
    env:
      SECRET: "${vault:prod/api-secret}"
```

Resolvers are loaded in order: built-in (`env`, `ssm`, `self`, `cfn`) first, then custom resolvers from the `resolver` array. Duplicate names throw an error.

### Return Values

- Return a `string` for inline replacement.
- Return a `Promise<string>` for async lookups (SSM, HTTP, etc.).
- Return any other type (object, array, number) when the expression is the full string value.
- Return `null` or the fallback when the key is not found.
