# Stealth Hosting Platform

Platform hosting untuk website HTML/PHP dan database dengan sistem authentication yang secure.

## Tech Stack

- **Frontend**: Next.js 16.4.5 dengan React 19
- **Authentication**: Better Auth dengan database sessions
- **Database**: PostgreSQL 16
- **Styling**: Tailwind CSS 4
- **Development**: Docker Compose

## Features

- ✅ Email/Password authentication
- ✅ Username dan avatar support
- ✅ Database sessions (stateful, secure, revocable)
- ✅ Protected routes
- ✅ Sign in / Sign up flow
- 🚧 Email verification (akan dikonfigurasi saat production)
- 🚧 Password reset (akan dikonfigurasi saat production)
- 🚧 OAuth (Google, GitHub) - coming soon
- 🚧 SSO - coming soon

## Prerequisites

- Node.js 26+
- Docker dan Docker Compose
- npm atau pnpm

## Setup Development

### 1. Clone dan Install Dependencies

```bash
npm install
```

### 2. Setup Environment Variables

Copy `.env.example` ke `.env.local`:

```bash
cp .env.example .env.local
```

File `.env.local` sudah dikonfigurasi untuk development.

### 3. Start PostgreSQL dengan Docker

```bash
docker compose up -d
```

Ini akan menjalankan PostgreSQL di `localhost:5432`.

### 4. Initialize Database

Jalankan migrasi resmi berdasarkan konfigurasi Better Auth:

```bash
npm run db:migrate
```

Untuk melihat SQL schema terlebih dahulu, gunakan `npm run auth:generate`. Kedua perintah memerlukan PostgreSQL yang sudah berjalan.

### 5. Run Development Server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000) di browser.

## Project Structure

```
app-steath/
├── app/
│   ├── api/auth/[...all]/    # Better Auth API routes
│   ├── dashboard/             # Protected dashboard page
│   └── page.tsx               # Login/signup page
├── components/
│   ├── protected-route.tsx    # Protected route wrapper
│   └── sidebar.tsx            # Dashboard sidebar
├── lib/
│   ├── auth.ts                # Server-side Better Auth config
│   └── auth-client.ts         # Client-side Better Auth hooks
├── database/
│   └── schema.sql             # Database schema reference
├── docker compose.yml         # PostgreSQL setup
└── .env.local                 # Environment variables (not committed)
```

## Development Workflow

### Sign Up Flow

1. User mengisi username, email, dan password di halaman utama
2. Click "Create Account"
3. Better Auth membuat user di PostgreSQL
4. User diredirect ke dashboard

### Sign In Flow

1. User mengisi email dan password
2. Click "Sign in"
3. Better Auth verify credentials
4. Session dibuat di database
5. User diredirect ke dashboard

### Session Management

- Sessions disimpan di PostgreSQL (stateful)
- Bisa revoke session kapan saja
- Cookie-based dengan secure settings
- Checkbox "remember me" menentukan lama sesi

## Database

### Connection String

Development: `postgresql://stealth:stealth_dev_password@localhost:5432/stealth_hosting`

### Schema

Better Auth CLI membuat tabel dan kolom sesuai versi serta plugin yang terpasang. Jalankan `npm run db:migrate` sebelum menguji signup.

### Access PostgreSQL

```bash
docker exec -it stealth-postgres psql -U stealth -d stealth_hosting
```

Useful commands:
```sql
-- List all tables
\dt

-- View users
SELECT id, email, name, email_verified, created_at FROM users;

-- View active sessions
SELECT id, user_id, expires_at FROM sessions;
```

## Production Deployment

### Environment Variables to Configure

```env
DATABASE_URL="postgresql://user:password@host:port/database"
BETTER_AUTH_SECRET="generate-a-secure-secret-min-32-characters"
BETTER_AUTH_URL="https://yourdomain.com"
NEXT_PUBLIC_BETTER_AUTH_URL="https://yourdomain.com"
RESEND_API_KEY="your_resend_api_key"  # For email verification
```

### Enable Email Verification

Update `lib/auth.ts`:

```typescript
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,  // Set to true
},
```

Setup Resend account dan tambahkan API key ke environment variables.

## Troubleshooting

### PostgreSQL tidak bisa connect

```bash
# Check if container is running
docker ps

# Restart container
docker compose restart

# Check logs
docker compose logs postgres
```

### Better Auth error

```bash
# Check Next.js dev server logs
# Biasanya ada detail error di terminal

# Clear .next cache
rm -rf .next
npm run dev
```

### Session tidak persist

- Check cookie settings di browser (should accept cookies from localhost)
- Check `.env.local` has correct `BETTER_AUTH_URL`
- Clear browser cookies dan coba lagi

## Next Steps

- [ ] Setup email service (Resend) untuk verification
- [ ] Tambah OAuth providers (Google, GitHub)
- [ ] Implement password reset flow
- [ ] Add profile edit page dengan avatar upload
- [ ] Setup role-based access control untuk hosting features
- [ ] Add hosting website management features
- [ ] Add database management features

## Resources

- [Better Auth Documentation](https://better-auth.com)
- [Next.js Documentation](https://nextjs.org/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
