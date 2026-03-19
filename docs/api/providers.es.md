# API de Proveedores

## Interfaz

Un proveedor es una funcion asincrona que recibe `parsed` y detecta el comando (`deploy`/`destroy`) de los argumentos del proceso:

```typescript
async function myProvider(parsed: z.infer<typeof Schema>): Promise<void> {
    const cmd = process.argv.includes('deploy') ? 'deploy'
        : process.argv.includes('destroy') ? 'destroy' : null;
    if (!cmd) return;

    const services = Object.entries(parsed.services)
        .filter(([, s]) => s.provider.name === 'myprovider');
    if (!services.length) return;

    // deploy o destroy
}
```

Los proveedores:

1. Detectan el comando de `process.argv`
2. Filtran servicios por `provider.name`
3. Si no hay servicios del proveedor, retornan sin hacer nada
4. Ejecutan deploy o destroy

## Archivo de estado

Cada proveedor lee y escribe el archivo `pctl.{name}.json`:

```typescript
function stFile(stack: string) {
    return resolvePath(process.cwd(), `pctl.${stack}.json`);
}

function stRead(stack: string): Record<string, any> {
    try { return JSON.parse(readFileSync(stFile(stack), 'utf-8')); }
    catch { return {}; }
}

function stWrite(stack: string, state: Record<string, any>) {
    writeFileSync(stFile(stack), JSON.stringify(state, null, 2));
}
```

El estado es un mapa de `{stack}-{service}` a metadata del recurso. Cada proveedor agrega sus propios campos.

### Formato AWS

```json
{
  "my-app-api": {
    "provider": "aws",
    "cluster": "prod",
    "namespace": "app",
    "registryUrl": "507738...ecr.../api",
    "image": "507738...ecr.../api:1710234567890",
    "labels": { "managed-by": "pctl", "pctl-stack": "my-app", "pctl-service": "my-app-api" },
    "fingerprint": "sha256...",
    "hasPorts": true,
    "hasHpa": true,
    "hasRbac": false,
    "hasPvc": false,
    "hasPv": false,
    "hasPullSecret": false,
    "pushedByPctl": true
  }
}
```

### Formato GCP

```json
{
  "my-app-api": {
    "provider": "gcp",
    "project": "my-project",
    "zone": "us-central1-a",
    "cluster": "prod",
    "namespace": "app",
    "registryUrl": "us-central1-docker.pkg.dev/.../api",
    "image": "us-central1-docker.pkg.dev/.../api:1710234567890",
    "labels": { "managed-by": "pctl", "pctl-stack": "my-app", "pctl-service": "my-app-api" },
    "fingerprint": "sha256...",
    "hasPorts": true,
    "hasHpa": true,
    "hasRbac": false,
    "hasPvc": false,
    "hasPv": false,
    "hasPullSecret": false,
    "pushedByPctl": true
  }
}
```

### Formato Docker

```json
{
  "my-app-api": {
    "provider": "docker",
    "host": "local",
    "user": null,
    "key": null,
    "sudo": false,
    "registryUrl": null,
    "image": "pctl-local:1710234567890",
    "labels": { "managed-by": "pctl", "pctl-stack": "my-app", "pctl-service": "my-app-api" },
    "fingerprint": "sha256...",
    "replica": 1,
    "hasPorts": true,
    "pushedByPctl": true
  }
}
```

## Labels

Todos los proveedores aplican labels consistentes:

```typescript
const lbl = (stack: string, name: string) => ({
    'managed-by': 'pctl',
    'pctl-stack': stack,
    'pctl-service': `${stack}-${name}`
});
```

| Label | Descripcion |
|---|---|
| `managed-by` | Siempre `pctl`. Identifica recursos gestionados por pctl |
| `pctl-stack` | Nombre del stack |
| `pctl-service` | `{stack}-{service}`. Identificador unico del servicio |

En Kubernetes, los labels se aplican a Deployment, Service, HPA, PV, PVC, ServiceAccount, Role, RoleBinding y Secret.

En Docker, se aplican como `--label` al contenedor.

## Fingerprint

El fingerprint es un hash SHA-256 del servicio (excluyendo `provider`) mas el contenido del Dockerfile (si aplica):

```typescript
function fingerprint(service: Service, configDir: string): string {
    const { provider, ...rest } = service;
    // Ordena claves recursivamente para consistencia
    let hash = JSON.stringify(sortKeys(rest));
    if (service.image.startsWith('./')) {
        const dockerfile = resolvePath(configDir, service.image);
        if (existsSync(dockerfile)) hash += createHash('md5').update(readFileSync(dockerfile)).digest('hex');
    }
    return createHash('sha256').update(hash).digest('hex');
}
```

El fingerprint se compara con el almacenado en el estado previo. Si son iguales, el servicio no se redespliega.

Esto permite:

- Cambiar opciones del proveedor sin reconstruir la imagen
- Detectar cambios en variables de entorno, puertos, health checks, etc.
- Detectar cambios en el Dockerfile
