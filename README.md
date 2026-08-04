# VisuPlanner

Visuel og fælles ugeplan til Team 2.

## Funktioner
- Én dag ad gangen
- Fast farve for hver ugedag
- Fleksibel bemanding på morgen, aften og nat
- Aftensmad med billede og Pexels-billedsøgning
- Aktiviteter med tidspunkt og billede
- Fælles teamlogin til beboertavlen og separat personalelogin
- Tilføjelse og fjernelse af medarbejdere og vikarer
- Fælles synkronisering gennem Supabase
- Ugeudgivelse og løbende ændringer
- Mobilvenlig PWA
- Onboardingformular og administratoroversigt over forespørgsler
- Selvbetjent nulstilling af personalekode via ansvarlig arbejdsmail
- Valgfri morgenmad og frokost
- Valgfri opdeling af dagvagten samt separat tilvalg af nattevagt

## Pexels

Vercel-projektet skal have miljøvariablen `PEXELS_API_KEY`. Nøglen bruges kun i serverfunktionerne under `api/` og må ikke lægges i GitHub eller i `app.js`.

## Sikker opsætning af Team 2
1. Opret en bekræftet Supabase-bruger med mailen `team2-viewer@visuplanner.invalid` og en selvvalgt fælles teamkode.
2. Udgiv de nye appfiler på Vercel.
3. Kør `supabase-security.sql` én gang i Supabase SQL Editor.

SQL-filen beskytter både tavledata og billeder bag login. Kun personalekontoen `team2@visuplanner.invalid` får skriverettigheder.

## Administratorpanel

Administratorpanelet findes på `/administration` og benytter kontoen `wiltrup@wiltrup.com`.

Før panelet bruges:
1. Opret og bekræft `wiltrup@wiltrup.com` i Supabase Authentication.
2. Kør `supabase-admin-foundation.sql` én gang i SQL Editor.
3. Tilføj Vercel-miljøvariablen `SUPABASE_SECRET_KEY` med projektets hemmelige Supabase-nøgle til Production, Preview og Development.
4. Redeploy seneste deployment i Vercel.

Den hemmelige nøgle må aldrig lægges i GitHub eller sendes til andre. Den anvendes kun i serverfunktionen `api/platform-admin.js`.

## Opdatering til version 21

Kør `supabase-v21-foundation.sql` én gang i Supabase SQL Editor. Scriptet tilføjer de nye indstillinger og tabeller uden at slette eksisterende data.

Teamets ansvarlige arbejdsmail bør være en rigtig, unik arbejdsmail. Når mailen ændres i administratorpanelet, kobles den til personaleloginnet og kan bruges til “Glemt personalekoden?”. Den samme mail kan ikke samtidig være Supabase-login for platformadministratoren.

Onboarding- og adgangsanmodninger gemmes altid i administratorpanelet. Tilføj miljøvariablen `RESEND_API_KEY` i Vercel og verificér `visuplanner.dk` hos Resend for også at modtage dem som mail på `wiltrup@wiltrup.com`. Hvis mailleveringen er nede, ligger anmodningen stadig sikkert i administrationen.

Team- og personalelogin gemmes kun i `sessionStorage`. Chrome, Safari og andre browsere kan selv tilbyde at huske loginoplysningerne. På en midlertidig computer kan brugeren derfor afslå browserens tilbud, og VisuPlanner-login forsvinder, når browsersessionen afsluttes.

## Udgivelse på Vercel
Upload alle filer og mapper i denne mappe til roden af GitHub-repository'et. Framework preset kan stå som `Other`, og der kræves ingen build command. Vercel udgiver automatisk efter commit.
