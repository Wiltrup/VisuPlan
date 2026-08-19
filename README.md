# VisuPlanner

## v43 – hele kunder, sluttider og ens klubtavler

Version 43 gør det muligt at arkivere og gendanne en hel kunde fra administrationen. En arkiveret kunde kan derefter slettes permanent med en ekstra tekstbekræftelse; det fjerner kundens tavler, klubtilbud, planer, filer og tekniske loginbrugere.

Aktiviteter på både team- og klubtavler kan nu have start- og sluttid. Klubtavlen har fået Pexels-billedsøgning og bruger samme dagsfarver, typografi, sidebredde, kortproportioner og footer som teamtavlerne. Nye klubadresser vises som `visuplanner.dk/kunde/klub`, mens de gamle `/tilbud/klub`-adresser fortsat virker.

### Opdatering fra v42

1. Kør `supabase-v43-customer-admin-and-activity-times.sql` én gang i Supabase SQL Editor. Scriptet tilføjer kun nye kolonner og bevarer eksisterende data.
2. Udgiv derefter v43-filerne via GitHub/Vercel.
3. Der skal ikke oprettes nye miljøvariabler.

## v42 – fælles tilbud og klubtavler

Version 42 tilføjer et centralt styret modul til fælles tilbud, fx “Trekløverets Klub”. Et tilbud har sit eget redigeringslogin, sin egen visningskode og kan valgfrit have en selvstændig tavle på `/tilbud/tilbuddets-navn`. Mad, aktiviteter og en kort besked redigeres ét sted og opdateres automatisk på alle tilknyttede teamtavler.

Platformadministratoren opretter tilbuddet under den betalende kunde og vælger, hvilke af kundens tavler der må bruge det. Hvert tilknyttet team kan derefter selv vælge at vise eller skjule tilbuddet under Grundindstillinger; teamet kan ikke tilknytte sig andre tilbud eller redigere klubbens indhold.

### Opdatering fra v40 eller v41

1. Kør `supabase-v42-shared-offers.sql` én gang i Supabase SQL Editor. Scriptet sletter eller ændrer ikke eksisterende tavler og ugeplaner.
2. Upload alle v42-filer til GitHub/Vercel.
3. Der skal ikke oprettes nye miljøvariabler.
4. Opret derefter det første fælles tilbud under den relevante kunde i `/administration`.

## v41 – udfyldt demo og opdateret forsideeksempel

Version 41 tilføjer Demo til forsidenavigationen. Demoen åbner nu med en færdig eksempeluge med fiktive medarbejdere, personalefotos, måltider og aktiviteter. Eksempelonsdagen viser lasagne med et lokalt billedaktiv, og forsidens tavleeksempel bruger de samme navne, fotos, måltid og aktiviteter som demoen.

## v40 – aktivering, dag-10-mail og frist til dag 25

Version 40 beholder den gratis prøveperiode på 14 dage. Hvis kunden vælger “Aktiver” under Grundindstillinger, fortsætter redigeringsadgangen frem til dag 25 fra prøvens start, mens Techus Nord behandler anmodningen. Uden en anmodning låses redigeringen efter dag 14. Tavlen kan fortsat ses efter en låsning.

Den daglige Vercel-kontrol sender nu også kunden én automatisk påmindelse på prøvens 10. dag. Administrationen viser både den almindelige prøvefrist og nedtællingen til dag 25 for kunder, der har anmodet om aktivering.

### Opdatering fra v38 eller v39

1. Kør `supabase-v40-trial-activation.sql` én gang i Supabase SQL Editor. Scriptet inkluderer MobilePay-ændringen fra v39 og sletter ingen kunde-, tavle-, ugeplan- eller betalingsdata.
2. Upload alle v40-filer til GitHub/Vercel.
3. Behold de eksisterende miljøvariabler, herunder `CRON_SECRET`. Der skal ikke oprettes nye.

## v39 – priser, Techus Nord og aktivering

Version 39 opdaterer prissiden, FAQ og vejledningen, så teksterne følger den aftalte prøve- og fakturaproces. VisuPlanner fremgår nu tydeligt som et produkt fra Techus Nord, CVR 46689984, mens Jakob Wiltrup krediteres for design og udvikling.

Derudover tilføjer versionen MobilePay som betalingsform i administrationen og placerer “Anmod om aktivering” under Grundindstillinger. Knappen er også tilgængelig, når prøveperioden er udløbet og den øvrige redigering er låst.

### Opdatering fra v38

1. Kør `supabase-v39-mobilepay.sql` én gang i Supabase SQL Editor. Scriptet sletter ingen kunde-, tavle- eller betalingsdata.
2. Upload alle v39-filer til GitHub/Vercel.
3. Der skal ikke oprettes nye miljøvariabler, hvis v38 allerede er sat op.
4. Kontrollér før kommerciel lancering virksomhedens fysiske adresse, faktisk Supabase-region og konkret betalingsleverandør, og få de juridiske tekster gennemgået fagligt.

## v38 – kunder, priser, prøveperiode og betaling

Version 38 samler flere selvstændige tavler under én betalende kunde og tilføjer:

- 14 dages gratis prøve med én tavle. Efter udløb kan tavlen fortsat ses, mens redigering låses.
- Pakker med op til 3, 8 eller 12 tavler samt skræddersyet tavlegrænse.
- Kunde-, EAN-, faktura-, betalings- og fornyelsesoverblik i administrationen.
- Separate aktiveringslinks, koder og URL'er til hver tavle under samme betaler.
- Redigering af kunde-, arbejdsplads-, kommune- og tavlenavne uden automatisk ændring af URL.
- Pris-, FAQ-, betingelses-, privatlivs-, databehandler- og underdatabehandlersider.
- Automatisk daglig kontrol, der sender administratoren en mail ca. 30 dage før årsfornyelse.
- Et dynamisk app-manifest, så hver tavle åbner den rigtige adresse, når den gemmes på telefonens hjemmeskærm.

### Rækkefølge ved installation

1. Kør `supabase-v38-commercial-foundation.sql` én gang i Supabase SQL Editor. Migrationen sletter ikke eksisterende tavler eller ugeplaner. Eksisterende tavler bliver aktive legacy-kunder og låses ikke.
2. Upload alle v38-filer til GitHub/Vercel.
3. Behold de eksisterende miljøvariabler `SUPABASE_SECRET_KEY`, `RESEND_API_KEY` og `PEXELS_API_KEY`.
4. Opret en ny stærk, tilfældig Vercel-miljøvariabel med navnet `CRON_SECRET`, og redeploy. Den beskytter den daglige fornyelseskontrol.
5. Kontrollér før kommerciel lancering virksomhedens fysiske adresse, faktisk Supabase-region, betalingsleverandør og få de juridiske tekster gennemgået fagligt.

Priserne i v38 er ekskl. moms: op til 3 tavler 1.850 kr. første år og derefter 2.200 kr.; op til 8 tavler 3.200/3.800 kr.; op til 12 tavler 4.400/5.200 kr.

## v29 – rettelse til Speak-optagelser

Kør `supabase-v29-audio-fix.sql` i Supabase, og upload derefter webfilerne. Rettelsen tillader lyd i medielageret og normaliserer browserens lydtype før upload.

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

## Samlet opdatering til version 26

Upload først alle v26-filer, og kør derefter `supabase-v26-multitenant.sql` én gang i Supabase SQL Editor. Scriptet indeholder også v25-onboardingens nødvendige databaseændringer, så v25 skal ikke uploades eller køres separat.

Team 2 flyttes automatisk fra `/team-2` til `/trekloeveret-team-2`, mens den gamle adresse viderestiller. Nye adresser dannes af arbejdsplads og team, fx `/trekloeveret-team-2`; hvis adressen allerede findes, tilføjes automatisk `-2`, `-3` osv.

Alle medarbejdere, planer, vagter, aktiviteter, indstillinger og nye billeder bindes til teamets adresse. Supabase-reglerne kontrollerer teamtilhørsforholdet ved både læsning og redigering. Administratoren kan oprette et team direkte fra en forespørgsel, hvorefter kunden modtager et 72-timers engangslink og selv vælger personale- og tavlekode.

## Udgivelse på Vercel
Upload alle filer og mapper i denne mappe til roden af GitHub-repository'et. Framework preset kan stå som `Other`, og der kræves ingen build command. Vercel udgiver automatisk efter commit.

## Opdatering til version 28

Kør først `supabase-v28-modules.sql` i Supabase SQL Editor. Upload derefter v28-filerne til GitHub. Denne rækkefølge sikrer, at den nye webkode ikke forsøger at hente modultabeller og lydfelter, før de findes.

Version 28 tilføjer:

- Nyt 72-timers invitationslink fra administrationen; tidligere ubrugte links ugyldiggøres.
- Sikker arkivering af kunder. Tavlen lukkes, mens data bevares.
- Valgfri fane med ugeopgaver og automatisk rotation hver mandag.
- Valgfrit VisuPlanner Speak med færdige danske lydfiler, medarbejdernes egne indtalte navne og særskilte optagelser til madretter og aktiviteter.
- Optagelser tæller ned fra 3 og kan bagefter afspilles, indtales igen eller slettes.
- Døgnvagt vises som én samlet vagt. Heldagsvagt kan kombineres med en særskilt nattevagt.
