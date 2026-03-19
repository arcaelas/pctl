# Resolvers

Los resolvers procesan patrones `${name:key, fallback}` en los valores de la configuracion y los reemplazan por valores reales antes de que el pipeline de plugins se ejecute.

## Sintaxis

```
${resolver:clave}
${resolver:clave, valor_fallback}
```

- **resolver** - Nombre del resolver (env, ssm, self, cfn, o uno personalizado)
- **clave** - Parametro pasado al resolver
- **valor_fallback** - Valor por defecto si el resolver retorna `null`

## Resolvers integrados

### env

Lee variables de entorno del proceso.

```yaml
env:
  NODE_ENV: ${env:NODE_ENV, development}
  API_KEY: ${env:API_KEY}
  PORT: ${env:PORT, 3000}
```

**Comportamiento**: Busca `key` en `process.env`. Si existe, retorna el valor. Si no, retorna el fallback. Si no hay fallback, retorna `null`.

### ssm

Lee parametros de AWS Systems Manager Parameter Store.

```yaml
env:
  DATABASE_URL: ${ssm:/myapp/prod/database-url}
  JWT_SECRET: ${ssm:/myapp/prod/jwt-secret, default-secret}
```

**Comportamiento**: Usa `GetParameterCommand` con `WithDecryption: true`. Cachea resultados por clave. Requiere `AWS_REGION` en el entorno o credenciales AWS configuradas. Si el parametro no existe o falla la peticion, retorna el fallback o `null`.

### self

Lee valores del propio objeto de configuracion ya parseado.

```yaml
custom:
  region: us-east-1
  cluster: prod

services:
  api:
    env:
      AWS_REGION: ${self:custom.region}
    provider:
      name: aws
      options:
        cluster: ${self:custom.cluster}
```

**Comportamiento**: Navega el objeto `parsed` usando notacion de punto. `${self:custom.region}` busca `parsed.custom.region`. Si la ruta no existe, retorna el fallback o `null`.

### cfn

Lee exports y outputs de stacks de AWS CloudFormation.

```yaml
env:
  # Export global de CloudFormation
  VPC_ID: ${cfn:SharedVpcId}

  # Output de un stack especifico
  DB_ENDPOINT: ${cfn:DatabaseStack.Endpoint}
  CACHE_URL: ${cfn:CacheStack.RedisUrl, redis://localhost:6379}
```

**Comportamiento**:

- **Sin punto** (`${cfn:ExportName}`): Busca en los exports globales de CloudFormation via `ListExportsCommand`
- **Con punto** (`${cfn:StackName.OutputKey}`): Busca en los outputs del stack especifico via `DescribeStacksCommand`
- Cachea todos los resultados. Requiere `AWS_REGION` y credenciales AWS.

## Anidamiento

Los resolvers soportan anidamiento. El resolver mas interno se resuelve primero:

```yaml
env:
  # Primero resuelve ${ssm:/config/env-var-name}, luego usa ese valor como clave para env
  DYNAMIC_VALUE: ${env:${ssm:/config/env-var-name}, fallback}

  # Primero resuelve ${self:custom.param_path}, luego consulta SSM con esa ruta
  DB_URL: ${ssm:${self:custom.param_path}, localhost}
```

Orden de resolucion: el motor recorre el string con una expresion regular que matchea `${name:args}`. Cuando encuentra una expresion anidada, resuelve la mas interna primero, reemplaza el resultado en el string, y continua procesando.

## Resolvers personalizados

Un resolver personalizado es una clase que extiende `Function`. El constructor recibe el objeto `parsed` y retorna una funcion nombrada.

```javascript
// resolvers/vault.js
const Vault = require('node-vault');

module.exports = class VaultResolver extends Function {
    constructor(parsed) {
        super();
        const client = Vault({ endpoint: process.env.VAULT_ADDR, token: process.env.VAULT_TOKEN });
        const cache = new Map();
        return function vault(key, fallback) {
            if (cache.has(key)) return cache.get(key) ?? fallback ?? null;
            return client.read(key)
                .then(res => {
                    const value = res.data?.value ?? null;
                    cache.set(key, value);
                    return value ?? fallback ?? null;
                })
                .catch(() => {
                    cache.set(key, null);
                    return fallback ?? null;
                });
        };
    }
};
```

### Registro

Agrega la ruta al modulo en el array `resolver` del YAML:

```yaml
resolver:
  - ./resolvers/vault.js

services:
  api:
    env:
      DB_PASSWORD: ${vault:secret/data/myapp/db-password}
```

### Reglas

- El nombre de la funcion retornada (`function vault(...)`) es el identificador del resolver en la sintaxis `${vault:...}`
- No puede colisionar con resolvers existentes (env, ssm, self, cfn). Si hay duplicado, lanza `Error: Resolver "name" already registered`
- La funcion recibe `(key, fallback)` y puede retornar un valor sincrono o una `Promise`
- El constructor recibe el objeto `parsed` completo para acceder a la configuracion
