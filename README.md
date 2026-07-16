# ValidaDoc — Validación Inteligente de Configuraciones DevOps

Aplicación web para comparar archivos de configuración (web.config, appsettings.json, .env, etc.) y detectar errores con IA (Google Gemini) antes de hacer pases a producción.

## Stack

- **Frontend + Backend**: Next.js 15 (App Router, TypeScript)
- **Base de datos + Auth**: Supabase (PostgreSQL + Supabase Auth)
- **IA**: Google Gemini 2.0 Flash
- **Despliegue**: Render (Web Service)

---

## 🚀 Setup Local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.local.example .env.local
```

Edita `.env.local` con tus valores reales (ver sección Variables de Entorno).

### 3. Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ve a **SQL Editor** y ejecuta los scripts en orden:
   ```
   scripts/01_create_usuarios.sql
   scripts/02_create_validaciones.sql
   ```
3. Ve a **Authentication → Settings** y configura:
   - **Site URL**: `http://localhost:3000`
   - **Redirect URLs**: `http://localhost:3000/**`

### 4. Obtener API Key de Gemini (gratis)

1. Ve a [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Crea una clave de API
3. Cópiala en `GEMINI_API_KEY` del `.env.local`

### 5. Ejecutar en desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000)

---

## 🌐 Despliegue en Render

### Paso 1: Subir código a GitHub

```bash
git init
git add .
git commit -m "feat: initial commit"
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

### Paso 2: Crear Web Service en Render

1. Ve a [render.com](https://render.com) y crea una cuenta
2. Click en **New → Web Service**
3. Conecta tu repositorio de GitHub
4. Configura:
   - **Name**: `validadoc`
   - **Region**: Oregon (US West) o la más cercana
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
   - **Plan**: Free

### Paso 3: Variables de Entorno en Render

En el dashboard de Render → Environment, agrega estas variables:

| Variable | Valor | Secreto |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | No |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | **Sí ✅** |
| `GEMINI_API_KEY` | `AIza...` | **Sí ✅** |
| `NEXT_PUBLIC_APP_URL` | `https://tu-app.onrender.com` | No |

> ⚠️ Marca `SUPABASE_SERVICE_ROLE_KEY` y `GEMINI_API_KEY` como **Secret** en Render para que no aparezcan en los logs.

### Paso 4: Actualizar Supabase para producción

En Supabase → **Authentication → Settings**:
- **Site URL**: `https://tu-app.onrender.com`
- **Redirect URLs**: `https://tu-app.onrender.com/**`

### Paso 5: Deploy

Render hace deploy automático con cada push a `main`. El primer deploy tarda ~3-5 minutos.

---

## 🔒 Seguridad Implementada

| Medida | Descripción |
|---|---|
| **GEMINI_API_KEY server-only** | Solo disponible en API Routes, nunca en el browser |
| **SUPABASE_SERVICE_ROLE_KEY server-only** | Solo para operaciones del servidor |
| **Row Level Security (RLS)** | Cada usuario solo ve sus propios registros |
| **JWT verification** | Cada API Route valida el token de Supabase antes de ejecutar |
| **userId del JWT** | El usuario_id siempre se extrae del token verificado, nunca del body |
| **Rate limiting** | Máximo 10 validaciones por minuto por usuario |
| **Límite de tamaño** | Máximo 200KB por archivo |
| **Sanitización** | Nombre de archivo sanitizado antes de guardar en BD |
| **No update/delete cliente** | Políticas RLS bloquean modificación de registros desde el cliente |

---

## 📁 Estructura del Proyecto

```
ValidacionInteligenteDevOps/
├── app/
│   ├── (auth)/login/page.tsx       # Página de login
│   ├── (auth)/register/page.tsx    # Página de registro
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Layout protegido (verifica sesión)
│   │   ├── validar/page.tsx        # Validador principal
│   │   └── historial/page.tsx      # Historial de validaciones
│   ├── api/
│   │   ├── validar/route.ts        # POST → Gemini AI
│   │   └── historial/route.ts      # GET → historial del usuario
│   ├── layout.tsx
│   ├── page.tsx                    # Redirect → /validar
│   └── globals.css                 # Design system completo
├── components/
│   ├── AuthForm.tsx                # Login / Registro
│   ├── FileComparator.tsx          # Upload + drag&drop + diff visual
│   ├── HistorialTable.tsx          # Tabla de historial
│   ├── Navbar.tsx                  # Barra de navegación
│   └── ValidationResult.tsx       # Resultado de la IA
├── lib/
│   ├── auth.ts                     # Verificación JWT server-side
│   ├── diff.ts                     # Diff línea a línea
│   ├── gemini.ts                   # Cliente Gemini (server-only)
│   ├── rateLimit.ts                # Rate limiting en memoria
│   └── supabase.ts                 # Clientes Supabase (browser + server)
├── scripts/
│   ├── 01_create_usuarios.sql      # Tabla usuarios + RLS + trigger
│   └── 02_create_validaciones.sql  # Tabla validaciones + RLS completo
├── types/index.ts                  # Tipos TypeScript compartidos
├── .env.local.example              # Template de variables de entorno
└── README.md
```

---

## 🧪 Uso de la Aplicación

1. **Registrarte** en `/register`
2. **Confirmar tu email** (Supabase envía un email de confirmación)
3. **Iniciar sesión** en `/login`
4. En el **Validador**:
   - Arrastra, sube o pega el archivo antiguo (producción) y el nuevo (a desplegar)
   - Click en **"Ver Diff"** para ver los cambios línea a línea
   - Click en **"Validar con IA"** para análisis completo con Gemini
5. Ver **Historial** de todas tus validaciones pasadas

---

## 📄 Licencia

MIT
