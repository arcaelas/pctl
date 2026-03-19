# API de Resolvers

## Interfaz

Un resolver es una clase que extiende `Function`. El constructor recibe el objeto `parsed` y retorna una funcion nombrada.

```typescript
class MyResolver extends Function {
    constructor(parsed: ParsedConfig) {
        super();
        return function myresolver(key: string, fallback?: any): any | Promise<any> {
            // resolver logica
        };
    }
}
```

### Requisitos

- La clase **debe** extender `Function`
- El constructor **debe** retornar una funcion nombrada
- El nombre de la funcion (`myresolver`) es el identificador usado en `${myresolver:key}`
- La funcion recibe `(key: string, fallback?: any)` y puede retornar un valor sincrono o una `Promise`
- No puede duplicar nombres de resolvers existentes

## Resolvers integrados

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

| Parametro | Descripcion |
|---|---|
| `key` | Nombre de la variable de entorno |
| `fallback` | Valor por defecto si la variable no existe |
| **Retorno** | `string \| null` (sincrono) |

### ssm

```typescript
class Ssm extends Function {
    constructor(_parsed: any) {
        super();
        const client = new SSMClient({ region: process.env.AWS_REGION });
        const cache = new Map<string, string | null>();
        return function ssm(key: string, fallback?: any) {
            if (cache.has(key)) return cache.get(key) ?? fallback ?? null;
            return client.send(new GetParameterCommand({ Name: key, WithDecryption: true }))
                .then(res => { /* cache + return */ })
                .catch(() => { /* cache null + return fallback */ });
        };
    }
}
```

| Parametro | Descripcion |
|---|---|
| `key` | Ruta del parametro SSM (ej. `/myapp/db-url`) |
| `fallback` | Valor por defecto si el parametro no existe o falla |
| **Retorno** | `Promise<string \| null>` |
| **Cache** | Si. Por clave. Persiste durante toda la ejecucion |
| **Requisitos** | `AWS_REGION` en el entorno |

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

| Parametro | Descripcion |
|---|---|
| `key` | Ruta con notacion de punto (ej. `custom.region`, `services.api.image`) |
| `fallback` | Valor por defecto si la ruta no existe |
| **Retorno** | `any` (sincrono). Retorna el valor tal cual esta en el objeto |

### cfn

```typescript
class Cfn extends Function {
    constructor(_parsed: any) {
        super();
        const client = new CloudFormationClient({ region: process.env.AWS_REGION });
        const cache = new Map<string, any>();
        // ... getExport, getOutput helper functions
        return function cfn(key: string, fallback?: any) {
            const dot = key.indexOf('.');
            if (dot === -1) return getExport(key).then(v => v ?? fallback ?? null);
            return getOutput(key.slice(0, dot), key.slice(dot + 1)).then(v => v ?? fallback ?? null);
        };
    }
}
```

| Parametro | Descripcion |
|---|---|
| `key` | Export name (`VpcId`) o `StackName.OutputKey` (`MyStack.Endpoint`) |
| `fallback` | Valor por defecto |
| **Retorno** | `Promise<string \| null>` |
| **Cache** | Si. Por export name y stack+output. Persiste durante toda la ejecucion |
| **Requisitos** | `AWS_REGION` en el entorno |

## Motor de resolucion

El motor de resolucion (`resolve/index.ts`) recorre el objeto `parsed` recursivamente:

1. **Strings**: Busca patrones `${name:args}` con la regex `/\$\{([^:}]+):([^{}]*)}/`
2. **Arrays**: Recorre cada elemento
3. **Objetos**: Recorre cada valor
4. **Otros tipos**: Se retornan sin modificar

Para cada match:

1. Extrae `name` (resolver) y `args` (clave + fallback separados por `,`)
2. Busca el resolver en el pool
3. Llama al resolver con los parametros
4. Si la expresion ocupa todo el string, reemplaza el string completo con el valor (puede ser objeto, numero, etc.)
5. Si la expresion es parte de un string mayor, convierte el valor a string para concatenar
6. Si el valor no es string (en contexto de concatenacion), genera una referencia interna `__pctl_N__` y la sustituye

## Registro de resolvers personalizados

Los resolvers personalizados se registran en el array `resolver` del YAML:

```yaml
resolver:
  - ./resolvers/vault.js
  - ./resolvers/http.js
```

Se cargan con `require()`, se instancian con `new Resolver(parsed)`, y se agregan al pool. El orden de registro es: `Env`, `Ssm`, `Self`, `Cfn`, seguido de los personalizados.

Si un resolver personalizado intenta usar un nombre ya registrado:

```
Error: Resolver "env" already registered
```
