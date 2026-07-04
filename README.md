# The Coffee Society

A slow reading room. Coffee history, its social benefits, and a public Q&A.

Built with Next.js 15, Supabase, and Vercel. Dark aesthetic. No LLM yet — you answer questions by hand from the admin panel.

---

## What you'll do (30-45 min, first time)

1. Set up Supabase database
2. Set up Vercel deploy
3. Push code to GitHub
4. Test locally
5. Answer your first question

---

## 1. Supabase setup (5 min)

You already have an account. Do this:

1. Go to https://supabase.com/dashboard → **New project**
2. Name: `coffee-society`. Region: closest to Cyprus (e.g. `eu-central-1`)
3. Set a strong DB password (save it — you won't need it for the code, but keep it)
4. Wait 1-2 min for provisioning
5. Go to **SQL Editor** → paste all of `migrations/migration1.sql` → **Run**
6. Go to **Settings → API** → copy these three values (you'll paste them in step 2):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY` **⚠️ never expose this to the browser**

---

## 2. Local test (10 min)

```bash
# In the project folder
cp .env.example .env.local
```

Open `.env.local` and paste the three Supabase values, and pick a strong `ADMIN_PASSWORD` (this is your admin login, only you know it).

Then:

```bash
npm install
npm run dev
```

Open http://localhost:3000

Test the flow end-to-end:
1. Go to `/ask`, submit a question with fake data
2. Go to `/admin`, log in with your `ADMIN_PASSWORD`
3. You should see the question in the Pending tab
4. Write an answer, click Publish
5. Go to `/archive` — your answer should be there

If any step fails, check the terminal for errors before continuing.

---

## 3. Push to GitHub (5 min)

```bash
git init
git add .
git commit -m "feat: initial coffee society site"

# Create a new empty repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/coffee-society.git
git branch -M main
git push -u origin main
```

---

## 4. Deploy to Vercel (10 min)

1. Go to https://vercel.com/new
2. **Import** your `coffee-society` GitHub repo
3. Framework preset: **Next.js** (auto-detected)
4. Before clicking Deploy, expand **Environment Variables** and add all four:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD`
5. Click **Deploy**
6. Wait ~1-2 min. When done, you'll get a URL like `coffee-society-xxx.vercel.app`

Test the live site the same way you tested locally.

---

## 5. (Later) Custom domain

Vercel → your project → **Settings → Domains → Add**. Point it at your domain via Cloudflare DNS. SSL is automatic.

---

## Daily use

- Someone submits a question → it lands in `/admin` → Pending
- You write an answer → click Publish → it appears in `/archive`
- Homepage is static, updates only when you edit the code and push to GitHub

---

## Content you can edit later

- **Coffee history**: `app/page.tsx` — four chapters, edit the prose freely
- **Benefits**: same file, the "What coffee has given us" section
- **Nav/Footer**: `components/Nav.tsx` and `components/Footer.tsx`
- **Colors**: `tailwind.config.ts` — change `blood`, `rust`, `bone` etc. and the whole site restyles

---

## Adding LLM later

When you're ready to auto-draft answers with an LLM:

1. Get an API key from https://console.anthropic.com or https://platform.openai.com
2. Add it as env var `ANTHROPIC_API_KEY` in Vercel + `.env.local`
3. In `answerQuestion` action, before saving, call the API to draft an answer, and pre-fill the admin's textarea with it
4. You still click "Publish" — this keeps quality control in your hands

Ask me when you want that.

---

## Structure

```
app/
├── page.tsx              # Homepage — coffee history + benefits
├── ask/page.tsx          # Public question form
├── archive/page.tsx      # Public archive of answered Q&As
├── admin/page.tsx        # Password-protected admin dashboard
├── actions/questions.ts  # Server actions (submit, answer, reject)
└── api/admin-login/      # Sets admin cookie after password check
components/
├── Nav.tsx
├── Footer.tsx
├── SubmitButton.tsx      # Loading spinner for forms
└── ConfirmForm.tsx       # Confirm dialog wrapper
lib/supabase/
├── server.ts             # Server client (for future auth)
└── admin.ts              # Service-role client (bypasses RLS)
migrations/
└── migration1.sql        # Questions table
```
