# API de Plugins

## Interfaz

Un plugin es una funcion asincrona que recibe el objeto `parsed`:

```typescript
async function myPlugin(parsed: z.infer<typeof Schema>): Promise<void> {
    // leer o mutar parsed
}
```

## Carga de plugins

Los plugins se definen como strings (rutas a modulos) en el array `plugin` del YAML:

```yaml
plugin:
  - ./plugins/logger.js
  - ./plugins/validate-env.js
```

El pipeline de carga:

```typescript
for (const fn of [resolve, validate, ...parsed.plugin, aws, docker, gcp]) {
    const mod = typeof fn === 'string' ? require(fn) : (typeof fn === 'function' ? fn : null);
    const handler = typeof mod === 'function' ? mod : mod?.default;
    if (typeof handler !== 'function') continue;
    await handler(parsed);
}
```

1. Si `fn` es un string → `require(fn)`
2. Si `fn` es una funcion → se usa directamente
3. Del modulo, busca primero el modulo como funcion, luego `module.default`
4. Si no es funcion, se omite silenciosamente
5. Se llama con `await handler(parsed)`

## Orden del pipeline

```
resolve → validate → plugin[0] → plugin[1] → ... → aws → docker → gcp
```

Los plugins del usuario se ejecutan **despues** de `resolve` y `validate`, pero **antes** de los proveedores. Esto significa que:

- Los resolvers ya procesaron todos los `${...}` del YAML
- El schema ya se valido
- Los plugins pueden mutar el objeto antes de que los proveedores lo lean

## Mutacion de parsed

Los plugins reciben la referencia directa al objeto `parsed`. Cualquier mutacion persiste:

```javascript
module.exports = async function addDefaults(parsed) {
    for (const service of Object.values(parsed.services)) {
        service.env = service.env ?? {};
        service.env.STACK_NAME = parsed.name;
    }
};
```

Los proveedores que se ejecutan despues veran `STACK_NAME` en las variables de entorno de cada servicio.

## Plugin validate (integrado)

El plugin `validate` hace dos verificaciones:

1. **Schema Zod**: Ejecuta `schema.safeParse(parsed)`. Si falla, formatea los errores y lanza:

```
Schema validation failed:
  - services.api.scale.replica: Expected number, received string
  - services.api.image: Required
```

2. **Regla de negocio**: Si `scale.replica` es un array `[min, max]`, verifica que `min <= max`:

```
Service "api": scale.replica min (5) cannot exceed max (3)
```

## Formato del modulo

### CommonJS

```javascript
// module.exports directo
module.exports = async function myPlugin(parsed) { };

// module.exports.default
module.exports.default = async function myPlugin(parsed) { };
```

### ESM (compilado a CJS)

```javascript
// export default
export default async function myPlugin(parsed) { }
```

pctl usa `require()` para cargar plugins, por lo que modulos ESM puros necesitan ser compilados a CommonJS o usar una extension que lo soporte.
