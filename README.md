# NetCo network lab

A small pretend company you deploy on Dokploy to practise networking for real: private and public addresses, ports, DNS, NAT, reverse proxy (Traefik), Docker networks, firewalls, Tailscale and Cloudflare tunnels.

**Follow [GUIDE.md](GUIDE.md) from top to bottom.**

Every service runs the same small program (`app/`) that shows a page answering three questions: *Who am I? How did you reach me? What can I reach?* Each check is marked "as expected" or "not as expected", so you always know if you got it right.
