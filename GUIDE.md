# NetCo network lab: step-by-step guide

You'll build a tiny company network on your server and test every networking idea with your own eyes. About 2 hours.

**What you need:** Dokploy installed, Tailscale installed (on the server and your laptop), a Cloudflare account (no domain needed), a GitHub account, and a phone with mobile data.

---

## The company you're building

```
                         INTERNET
                            │
                 Cloudflare quick tunnel  (public, https)
                            │
  ┌──────────────── YOUR SERVER ──────────────────────────────────────────┐
  │                                                                       │
  │  Traefik (reverse proxy, doors 80/443) ── staff on office network     │
  │        │                                                              │
  │   ┌── frontend network (has internet) ──────────┐                     │
  │   │  tunnel      website ────► api              │                     │
  │   └──────────────────────────────┼──────────────┘                     │
  │   ┌── backend network (NO internet) ─┼──────────┐                     │
  │   │                    api ────► db             │                     │
  │   │  worker ─────► db       admin ────► db      │                     │
  │   └────────────────────────────────┼────────────┘                     │
  │                                    │ door 8081, ONLY on Tailscale IP  │
  └────────────────────────────────────┼──────────────────────────────────┘
                                       │
                          TAILSCALE (your team only)
```

| Service | Who may reach it | Why (like a real company) |
|---|---|---|
| `website` | Everyone (public) | Customers visit it |
| `api` | Only other containers | The website uses it; customers never call it directly |
| `db` | Only `api`, `worker`, `admin` | Databases are never exposed |
| `worker` | Nobody; it has no internet either | Background jobs don't need the internet, so we cut it off |
| `admin` | Only your team, through Tailscale | Staff tools stay private |
| `tunnel` | Nobody; it only dials out | Makes the website public without opening router doors |
| `payroll` (separate) | Nobody | Another team's app, kept separate |

---

## Step 0: Fill in your address sheet

**Why:** networking is all about addresses. You'll use these numbers in later steps, and seeing them side by side is the first lesson.

**How:** on the server's terminal, run:

```bash
hostname -I          # first number = the server's address on your office network (LAN)
tailscale ip -4      # the server's Tailscale address (starts with 100.)
```

Write them down:

| Name | Your value | What it is |
|---|---|---|
| `<LAN-IP>` | | The server's address **inside your office**. Only office devices can use it. |
| `<TS-IP>` | | The server's address **on Tailscale**. Only your Tailscale devices can use it. |
| Public IP | (you'll see it in Step 5) | The one address the **whole internet** sees for your office. |

Everywhere this guide says `<LAN-IP>` or `<TS-IP>`, type your own value.

---

## Step 1: Lock the doors before opening any

**Why:** a safe network starts closed. Then you open only what you need, on purpose.

**1.1 Router: no port forwarding.**
Open your router's admin page (often `192.168.1.1` in a browser). Find "Port Forwarding" or "NAT". If any rule points to `<LAN-IP>`, delete it.
*Why:* port forwarding lets strangers on the internet knock directly on your server. In this lab, public visitors come through a Cloudflare tunnel instead, so no door is needed.

**1.2 Server firewall.** On the server, run these lines one by one. Allow SSH **first**, or you could lock yourself out.

```bash
sudo ufw allow OpenSSH
sudo ufw allow in on tailscale0
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status
```

*Why:* "deny incoming" closes all doors by default. "allow outgoing" lets the server reach the internet (updates, GitHub, Cloudflare). Tailscale traffic from your own devices is allowed.

> **Important lesson:** doors that Docker opens (with `ports:`) skip this firewall, because Docker writes its own rules. That's why, later, the admin door is opened only on the Tailscale address, never on "everything".

**Verify:** `sudo ufw status` shows **Status: active**, with OpenSSH and tailscale0 allowed.

---

## Step 2: Put the project on GitHub

**Why:** in a real company, everything that describes the system lives in Git. Dokploy reads it from there.

1. On GitHub, click **New repository**, name it `netco-lab`, and choose **Public** (simplest for this lab). Click **Create repository**.
2. Click **uploading an existing file**.
3. Unzip `netco-lab.zip` on your computer and **open the folder**. Select **everything inside it** (`app`, `hr`, `docker-compose.yml`, `GUIDE.md`, `README.md`, `.gitignore`) and drag them into the page. Don't drag the folder itself.
4. Click **Commit changes**.

**Verify:** your repo's main page shows `docker-compose.yml` directly, next to the `app` and `hr` folders. If you see a `netco-lab` folder instead, delete the repo and upload again. The settings in Step 3 only reach the containers when `docker-compose.yml` sits at the top.

---

## Step 3: Deploy the company in Dokploy

**Why:** one Compose service in Dokploy creates all the company's containers and their networks, from the YAML file.

1. In Dokploy, open **Projects → Create Project**. Name it `netco` and click **Create**.
2. Open the project and click **Create Service → Compose**. Name it `company` and click **Create**.
3. **General** tab:
   - Provider: **Git** (or **GitHub**, if you connected it in Settings → Git)
   - Repository URL: `https://github.com/<your-github-name>/netco-lab.git`
   - Branch: `main`
   - Compose Path: `./docker-compose.yml`
   - Click **Save**.
4. **Environment** tab: paste this, put in your own Tailscale address, and click **Save**.
   ```
   COMPANY_NAME=NetCo
   DB_PASSWORD=NetcoDb2026pass
   TAILSCALE_IP=<TS-IP>
   ADMIN_PORT=8081
   ```
   *Why:* passwords and per-server values never go in the YAML or GitHub. The YAML says `${DB_PASSWORD}`, and Dokploy fills it in.
5. **Domains** tab → **Add Domain**:
   - Service Name: `website`
   - Host: `website.<LAN-IP>.sslip.io` (for example `website.192.168.1.50.sslip.io`)
   - Path: `/`
   - Container Port: `3000`
   - HTTPS: **off**
   - Click **Create**.

   *Why:* this tells Traefik, the receptionist, "visitors asking for this name go to the website container, door 3000." `sslip.io` is a free phone book that answers with the IP written inside the name.
6. Go back to **General** and click **Deploy**.
7. Open the **Deployments** tab and wait until it says **Done** (2 to 4 minutes the first time).

**Verify:** the **Containers** tab shows 6 containers running: website, api, worker, admin, db, tunnel.

---

## Step 4: Visit the website through the reverse proxy

**Why:** this is the normal way web traffic reaches a container: name → DNS → server door 80 → Traefik → container.

**Do:** on a computer in your office, open `http://website.<LAN-IP>.sslip.io`.

**What you should see, and what it teaches:**

| On the page | What it means |
|---|---|
| Top line: **4 of 4 network checks as expected** (green) | Everything is wired correctly |
| Company setting: **loaded (NetCo)** | Your Environment tab values reached the container |
| **Who am I → My private addresses:** two addresses like `172.x.x.x` and `10.x.x.x` | Private addresses that exist only inside the server. **Two** because the website is on two networks: `frontend`, and Dokploy's shared network (added because you gave it a domain). |
| **My phone book: `127.0.0.11`** | Docker's built-in DNS. It knows container names like `api` and `db`. |
| **How did you reach me: Your browser → Traefik → this container** | The reverse proxy delivered you |
| **Name you typed:** `website.<LAN-IP>.sslip.io` | Traefik used this name to choose the container |
| **Protocol: http (not encrypted)** | Inside the office, no padlock yet. That comes in Step 7. |
| Check `api:3000`: **Reached** | Same network, so the name works |
| Check `db:5432`: **Not reached, name not found** | The website is NOT on the backend network, so it can't even find the database. That's **network separation**: if the website is ever hacked, the attacker still can't touch the database. |
| Check `internet`: **Reached. The internet sees us as `x.x.x.x`** | Going out works by itself. Write this **public IP** in your address sheet. |

**Now compare your three addresses:** container `172.x.x.x`, server `<LAN-IP>`, public `x.x.x.x`. The same request used all three. Docker swapped the container's address for the server's, then your router swapped the server's for the public one. That swapping is called **NAT**.

**Also click "Ask the API".** You get the API's container name and addresses. *Why it matters:* your browser can't reach the API; the website asked it **from the inside**, by name. That's how real companies hide their APIs and databases.

---

## Step 5: Look inside the private services

**Why:** `api`, `worker` and `db` have no domain and no doors, so you can only see them from inside. This is how you'll check private services in real life.

**5.1 Through the Logs tab (easiest).**
Go to the **Logs** tab and choose the `worker` container. Within a minute you'll see lines like:

```
[worker] db:5432        REACHED     (as expected)
[worker] api:3000       REACHED     (as expected)
[worker] website:3000   NOT REACHED (as expected)
[worker] internet       NOT REACHED (as expected)
```

| What you see | What it teaches |
|---|---|
| worker reaches `db` and `api` | They share the `backend` network |
| worker can't find `website` | Different network, invisible |
| worker has **no internet** | The `backend` network is marked `internal: true` in the YAML. Outbound traffic can be blocked too, which is good for things that never need the internet. |

Then choose the `api` container in Logs:

```
[api] db:5432        REACHED  (as expected)
[api] website:3000   REACHED  (as expected)
[api] internet       REACHED  (as expected)
```

*Why does api have internet but worker doesn't?* The api is **also** on the `frontend` network, which is a normal network with internet. A container can be on several networks and gets what each one allows.

**5.2 Through the Terminal (how engineers do it).**
Go to **Containers**, open the `api` row's menu, and choose **Terminal**. Then type:

```sh
wget -qO- http://localhost:3000/info.json
```

You get the same report as text, from inside the container. Then try:

```sh
nslookup db
nslookup website
```

`db` answers with a `172.x` or `10.x` address: Docker's phone book at work.

**5.3 Prove the database is closed from outside.**
From your laptop's terminal, run:

```bash
nc -zv <LAN-IP> 5432
```

Expected: **connection refused / timed out**. The database has no door on the server. Only containers on the `backend` network can reach it.

---

## Step 6: Team-only access with Tailscale (admin)

**Why:** staff tools should be reachable from anywhere by your team, and by nobody else. Tailscale gives that without opening anything to the internet.

**How it's built:** in the YAML, the admin line is:

```yaml
ports:
  - "${TAILSCALE_IP:-127.0.0.1}:${ADMIN_PORT:-8081}:3000"
```

Read aloud: "Open door **8081** on the server, **only on the Tailscale address**, and connect it to door 3000 of the admin container."

**Test 1: from your laptop with Tailscale ON**
Open `http://<TS-IP>:8081`.
**Expected:** the admin page, with **4 of 4 checks as expected** and the path "Directly to this container's door (no proxy)". You came through a published port, not through Traefik.

**Test 2: same laptop, office address**
Open `http://<LAN-IP>:8081`.
**Expected:** **doesn't load**. The door only exists on the Tailscale address.

**Test 3: turn Tailscale OFF on your laptop**
Open `http://<TS-IP>:8081` again.
**Expected:** **doesn't load**. Without Tailscale, the 100.x address leads nowhere.

**Bonus:** install the Tailscale app on your phone, log in with the same account, and open `http://<TS-IP>:8081` on **mobile data**. It works from anywhere, privately.

---

## Step 7: Make the website public with a Cloudflare tunnel

**Why:** customers on the internet must reach the website, but you didn't open any router door. The tunnel container **dials out** to Cloudflare (going out always works), and Cloudflare sends visitors back down that line.

You're using a **quick tunnel**: it needs no domain, and Cloudflare gives a random `https://...trycloudflare.com` address. It's perfect for practice.

1. Open the **Logs** tab and choose the `tunnel` container.
2. Find the box that says **"Your quick Tunnel has been created! Visit it at"**, followed by an address like `https://random-words-here.trycloudflare.com`. Copy that address.
3. On your phone, **turn Wi-Fi OFF** (mobile data only, so you're truly outside your office), and open the address.

**Expected:**

| On the page | What it means |
|---|---|
| **Internet → Cloudflare → tunnel → this container** | The public path works |
| **Protocol: https (encrypted, padlock)** | Cloudflare added the padlock for free |
| **Your address:** your phone's mobile IP | Cloudflare passes on who the real visitor is |
| A padlock in the phone's address bar | Visitors are protected |

4. Still on the phone, try opening `http://<your public IP>` (from your address sheet).
**Expected:** **doesn't load**. Your office has no open doors. The tunnel is the only way in.

> **Note:** the quick tunnel address changes every time the tunnel restarts. Real companies buy a domain and use a "named tunnel" with a fixed name, like `www.company.com` (see "Next level" at the end).

---

## Step 8: Another team's app stays separate

**Why:** in a real company, different teams' apps shouldn't see each other unless they must.

1. In the `netco` project, click **Create Service → Compose**, name it `hr`, and click **Create**.
2. **General:** same repository, branch `main`, Compose Path `./hr/docker-compose.yml`. Click **Save**.
3. No environment and no domain. Click **Deploy**.
4. **Logs** tab → `payroll` container. **Expected:**
   ```
   [payroll] website:3000   NOT REACHED (as expected)
   [payroll] api:3000       NOT REACHED (as expected)
   [payroll] db:5432        NOT REACHED (as expected)
   [payroll] internet       REACHED     (as expected)
   ```

*Why:* every Compose service gets its own private network. Payroll can go out to the internet, but it can't see NetCo's containers, and they can't see it.

And on the NetCo website page, the check `payroll:3000` should say **Not reached (as expected)**.

---

## Step 9: Break it and fix it

**Why:** you really understand a network when you can recognise what's broken. Do one at a time, and fix each before the next.

**Drill 1: Wrong door number**
- **Break:** Domains → edit the website domain → set Container Port to `4000` → save → **Deploy**. Then open `http://website.<LAN-IP>.sslip.io`.
- **You'll see:** **Bad Gateway**.
- **Lesson:** Traefik found the name but knocked on a door where nothing listens.
- **Fix:** set it back to `3000` and Deploy.

**Drill 2: Unknown name**
- **Break:** open `http://shop.<LAN-IP>.sslip.io` (a name you never added).
- **You'll see:** **404 page not found**.
- **Lesson:** the request reached Traefik, but no domain rule matches that name. Nothing to fix; it's just a lesson.

**Drill 3: Opening a door too wide (the dangerous mistake)**
- **Break:** Environment → set `TAILSCALE_IP=0.0.0.0` → **Save** → **Deploy**. Then, from an office laptop **without** Tailscale, open `http://<LAN-IP>:8081`.
- **You'll see:** the admin page opens for **anyone** on the office network, and the firewall from Step 1 did **not** stop it (Docker skips it).
- **Lesson:** `0.0.0.0` means "every address". This is how private tools get exposed by accident.
- **Fix:** set `TAILSCALE_IP=<TS-IP>` again, Save, Deploy, and check that `http://<LAN-IP>:8081` no longer loads.

**Drill 4: Database down**
- **Break:** Containers → `db` → **Stop**. On the website, click **Ask the API**.
- **You'll see:** the API's check `db:5432` says *door refused* or *not found*, **NOT as expected**.
- **Lesson:** this is how one broken service shows up in another one's checks.
- **Fix:** Containers → `db` → **Start**, then ask again.

**Drill 5: Wrong name in the phone book**
- **Break:** Environment → add `WEBSITE_API_URL=http://apii:3000` (typo on purpose) → Save → **Deploy** → click **Ask the API**.
- **You'll see:** **Name not found: the phone book has no "apii"**.
- **Lesson:** most "can't connect" problems are really name problems.
- **Fix:** delete the `WEBSITE_API_URL` line, Save, Deploy.

**Drill 6: The tunnel address changes**
- **Break:** Containers → `tunnel` → **Restart**. Then check Logs for the new address.
- **You'll see:** the old `trycloudflare.com` address stops working, and a new one appears.
- **Lesson:** quick tunnels are temporary. That's why businesses use their own domain.

---

## Step 10: Final check

Tick every box:

- [ ] Website via Traefik (`http://website.<LAN-IP>.sslip.io`) shows **4 of 4 as expected**.
- [ ] "Ask the API" answers from inside.
- [ ] Logs: worker shows **no internet (as expected)**; api shows internet **reached**.
- [ ] `nc -zv <LAN-IP> 5432` from your laptop is refused.
- [ ] Admin opens at `http://<TS-IP>:8081` with Tailscale on, and fails without it or on `<LAN-IP>`.
- [ ] Phone on mobile data opens the `trycloudflare.com` address with a padlock.
- [ ] Phone on mobile data **can't** open `http://<public IP>`.
- [ ] Payroll can't see NetCo, and NetCo can't see payroll.
- [ ] All 6 drills broken and fixed.

---

## What each step taught you

| Idea | Where you saw it |
|---|---|
| Private vs public addresses | Step 0 address sheet; Step 4 addresses |
| NAT (address swapping, going out) | Step 4 public IP vs container IP |
| Ports (doors) | Step 3 container port 3000; Step 6 door 8081; Drill 1 |
| DNS (phone book) | `sslip.io` in Step 3; `127.0.0.11` in Step 4; Drill 5 |
| Reverse proxy (Traefik) | Steps 3 and 4; Drills 1 and 2 |
| Docker networks and separation | Steps 4, 5 and 8 |
| Blocking outbound traffic | Step 5 worker (`internal: true`) |
| Firewall, and why Docker skips it | Step 1; Drill 3 |
| VPN / Tailscale | Step 6 |
| Tunnel and HTTPS | Step 7; Drill 6 |
| Router safety (no port forwarding) | Step 1; Step 7 test 4 |

---

## Next level (optional, when you're ready)

Buy a cheap domain (Cloudflare Registrar, about 10 USD a year) and you can practise what real companies do:
- **Named tunnel:** a fixed address like `www.yourdomain.com` instead of a random one.
- **Cloudflare Access:** a login page in front of `admin.yourdomain.com`, so staff without Tailscale can sign in with their company email.
- **Your own DNS records:** add `A` and `CNAME` records yourself and watch names change where they lead.

## Clean up

To remove the lab: in Dokploy, open each service (`company`, `hr`) and delete it (choose to delete volumes), then delete the `netco` project. If you want, run `sudo ufw status` and keep the firewall on; it's good practice anyway.
