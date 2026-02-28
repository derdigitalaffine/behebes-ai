# Redmine Ticket Field Mapping - Technische Dokumentation

## 1. DATENFLUSS-ÜBERSICHT

```
anliegen (lokale DB)
    ↓
RedmineAPI::buildIssueData()
    ├─ Standardfelder
    ├─ Description generieren
    ├─ Zuweisung ermitteln
    └─ Custom Fields mappen
    ↓
POST /issues.json (Redmine API)
    ↓
Response: { issue: { id: NUMBER } }
    ↓
anliegen.redmine_id = RESPONSE.issue.id
anliegen.status = 'in_redmine'
```

---

## 2. STANDARDFELDER (Issue Core)

```javascript
{
  "issue": {
    "project_id": 93,              // KONSTANTE
    "tracker_id": 20,              // KONSTANTE
    "status_id": 1,                // KONSTANTE (initial)
    "subject": "Bürgermeldung: " + beschreibung.substring(0, 100),
    "description": STRING,         // siehe Section 3
    "assigned_to_id": NUMBER       // siehe Section 5
  }
}
```

**Feldtypen:**
- `project_id`: INTEGER
- `tracker_id`: INTEGER
- `status_id`: INTEGER
- `subject`: STRING (max 100 chars)
- `description`: STRING (unlimited)
- `assigned_to_id`: INTEGER

---

## 3. DESCRIPTION-FIELD GENERATOR

```php
// Input: $anliegen (array)
// Output: $description (string)

$categoryName = queryDB("SELECT name FROM categories WHERE id = ?", $anliegen['kategorie_id']);

$street = $anliegen['strasse'] 
    ? "{$anliegen['strasse']} {$anliegen['hausnummer']}" 
    : "Nicht angegeben";

$gps = ($anliegen['lat'] && $anliegen['lng'])
    ? "https://www.google.com/maps?q={$anliegen['lat']},{$anliegen['lng']}"
    : "Nicht angegeben";

$phone = $anliegen['telefon'] ?: "Nicht angegeben";

$description = sprintf(
    "Bürgermeldung\n\n" .
    "Kategorie: %s\n" .
    "Beschreibung: %s\n\n" .
    "Ort: %s\n" .
    "Straße: %s\n" .
    "GPS: %s\n\n" .
    "Kontakt:\n" .
    "Name: %s %s\n" .
    "Email: %s\n" .
    "Telefon: %s",
    $categoryName,
    $anliegen['beschreibung'],
    $anliegen['ort'],
    $street,
    $gps,
    $anliegen['vorname'] ?: '',
    $anliegen['nachname'],
    $anliegen['email'],
    $phone
);

// RETURN $description: STRING
```

**Template-Logik:**
```
IF strasse AND hausnummer THEN street = strasse + " " + hausnummer
ELSE street = "Nicht angegeben"

IF lat AND lng THEN gps = "https://www.google.com/maps?q=" + lat + "," + lng
ELSE gps = "Nicht angegeben"

IF telefon THEN phone = telefon
ELSE phone = "Nicht angegeben"

IF vorname THEN name = vorname + " " + nachname
ELSE name = nachname
```

---

## 4. CUSTOM FIELDS ARRAY

```javascript
{
  "custom_fields": [
    { "id": 37, "value": ort },                    // STRING
    { "id": 38, "value": lat || '' },             // STRING (float as string or empty)
    { "id": 39, "value": lng || '' },             // STRING (float as string or empty)
    { "id": 40, "value": '' },                    // STRING (always empty - no filename support)
    { "id": 41, "value": email },                 // STRING (email format)
    { "id": 42, "value": telefon || '' },         // STRING or empty
    { "id": 43, "value": strasse || '' },         // STRING or empty
    { "id": 44, "value": hausnummer || '' },      // STRING or empty
    { "id": 45, "value": vorname || '' },         // STRING or empty
    { "id": 46, "value": nachname },              // STRING
    { "id": 47, "value": '' },                    // STRING (always empty - no image support)
    { "id": 48, "value": CATEGORY_MAP[kategorie_id].name }  // STRING (mapped)
  ]
}
```

**Mapping-Logik:**
```
FUNCTION mapCustomFields(anliegen):
  LET categoryMappedName = CATEGORY_MAP[anliegen.kategorie_id].name
  
  RETURN [
    { id: 37, value: coalesce(anliegen.ort, '') },
    { id: 38, value: coalesce(anliegen.lat, '') },
    { id: 39, value: coalesce(anliegen.lng, '') },
    { id: 40, value: '' },                    // NOT IMPLEMENTED
    { id: 41, value: anliegen.email },
    { id: 42, value: coalesce(anliegen.telefon, '') },
    { id: 43, value: coalesce(anliegen.strasse, '') },
    { id: 44, value: coalesce(anliegen.hausnummer, '') },
    { id: 45, value: coalesce(anliegen.vorname, '') },
    { id: 46, value: anliegen.nachname },
    { id: 47, value: '' },                    // NOT IMPLEMENTED
    { id: 48, value: categoryMappedName }
  ]
```

---

## 5. ZUWEISUNG LOGIC (assigned_to_id)

```php
FUNCTION getAssigneeForCategoryAndLocation(kategorie_id, ort):
  
  // PRIORITY 1: Location-specific assignee
  LET assigneeId = queryDB(
    "SELECT cla.redmine_assignee_id
     FROM category_location_assignees cla
     JOIN locations l ON l.id = cla.location_id
     WHERE cla.category_id = ? AND l.name = ?",
    [kategorie_id, ort]
  )
  
  IF assigneeId EXISTS:
    RETURN assigneeId
  
  // PRIORITY 2: Category default assignee
  LET assigneeId = queryDB(
    "SELECT redmine_assignee_id FROM categories WHERE id = ?",
    [kategorie_id]
  )
  
  RETURN assigneeId  // may be NULL
  
  // On NULL: THROW Exception
```

**Tabellen-Abhängigkeiten:**
```
1. category_location_assignees
   ├─ category_id (INT, FK → categories.id)
   ├─ location_id (INT, FK → locations.id)
   ├─ redmine_assignee_id (INT)
   └─ UNIQUE KEY (category_id, location_id)

2. categories
   ├─ id (INT, PK)
   ├─ name (VARCHAR)
   ├─ redmine_assignee_id (INT) [DEFAULT for category]
   └─ status_id (INT)

3. locations
   ├─ id (INT, PK)
   ├─ name (VARCHAR) [referenced in query]
   └─ active (BOOLEAN)
```

---

## 6. KATEGORIE-MAPPING

```php
$categoryMap = [
    // Projekt 187 (Stadtverwaltung)
    '1'  => ['id' => 187, 'name' => 'Sturmschäden im öffentlichen Bereich'],
    '2'  => ['id' => 187, 'name' => 'Bürgersteig'],
    '3'  => ['id' => 187, 'name' => 'Müll auf öff. Bereich'],
    '4'  => ['id' => 187, 'name' => 'Müll auf priv. Bereich'],
    '5'  => ['id' => 187, 'name' => 'Spielplatz'],
    '6'  => ['id' => 187, 'name' => 'Friedhof'],
    '7'  => ['id' => 187, 'name' => 'Straße-Ort / Wirtschaftsweg'],
    '12' => ['id' => 187, 'name' => 'Vandalismus'],
    '14' => ['id' => 187, 'name' => 'Wildwuchs / Unkraut / Reinigung priv. Gelände'],
    '15' => ['id' => 187, 'name' => 'Konflikte mit Nachbarn'],
    '32' => ['id' => 187, 'name' => 'Sonstiges'],
    
    // Projekt 192 (Verkehr/Straßen)
    '8'  => ['id' => 192, 'name' => 'Straße Kxx (Kreis-Str)'],
    '9'  => ['id' => 192, 'name' => 'Straße Lxx (Landes-Str)'],
    '10' => ['id' => 192, 'name' => 'Straße Bxx (B270)'],
    '11' => ['id' => 192, 'name' => 'Straßenlaternen'],
    '17' => ['id' => 192, 'name' => 'Konflikt Lärmbelästigung'],
    '18' => ['id' => 192, 'name' => 'Verkehrsschilder/Ampel'],
    '19' => ['id' => 192, 'name' => 'Baustelle'],
    '20' => ['id' => 192, 'name' => 'Parken'],
    '30' => ['id' => 192, 'name' => 'Eichenprozessionsspinner (nur saisonal)'],
    
    // Projekt 53 (Versorgung/Infrastruktur)
    '13' => ['id' => 53, 'name' => 'Wildwuchs / Unkraut / Reinigung öf.f Gelände'],
    '16' => ['id' => 81, 'name' => 'Konflikte mit Verwaltung'],  // EXCEPTION!
    '21' => ['id' => 53, 'name' => 'Fernwärme'],
    '22' => ['id' => 53, 'name' => 'Gas'],
    '23' => ['id' => 53, 'name' => 'Kanal'],
    '24' => ['id' => 53, 'name' => 'Müllabfuhr'],
    '25' => ['id' => 53, 'name' => 'Strom'],
    '26' => ['id' => 53, 'name' => 'Wasserleitung'],
    '27' => ['id' => 53, 'name' => 'Amtsblatt nicht erhalten'],
    '28' => ['id' => 53, 'name' => 'Abflusshinderniss in Bachlauf'],
    '29' => ['id' => 53, 'name' => 'Ratten'],
    '31' => ['id' => 53, 'name' => 'illegales Bauen']
];

FUNCTION getCategoryMappedName(kategorie_id: INTEGER): STRING
  RETURN categoryMap[kategorie_id.toString()].name
  // Throws: KeyError if kategorie_id not in map
```

---

## 7. KOMPLETTER PAYLOAD BEISPIEL

```json
{
  "issue": {
    "project_id": 93,
    "tracker_id": 20,
    "status_id": 1,
    "subject": "Bürgermeldung: Müll bei der Schule neben dem Spielplatz",
    "description": "Bürgermeldung\n\nKategorie: Müll auf öff. Bereich\nBeschreibung: Es liegt überall Müll neben dem Spielplatz rum\n\nOrt: Otterbach\nStraße: Schulstraße 5\nGPS: https://www.google.com/maps?q=49.3456789,8.1234567\n\nKontakt:\nName: Max Mustermann\nEmail: max@example.de\nTelefon: 06301 123456",
    "assigned_to_id": 42,
    "custom_fields": [
      { "id": 37, "value": "Otterbach" },
      { "id": 38, "value": "49.3456789" },
      { "id": 39, "value": "8.1234567" },
      { "id": 40, "value": "" },
      { "id": 41, "value": "max@example.de" },
      { "id": 42, "value": "06301 123456" },
      { "id": 43, "value": "Schulstraße" },
      { "id": 44, "value": "5" },
      { "id": 45, "value": "Max" },
      { "id": 46, "value": "Mustermann" },
      { "id": 47, "value": "" },
      { "id": 48, "value": "Müll auf öff. Bereich" }
    ]
  }
}
```

---

## 8. DATENBANK-SCHNITTSTELLE

```php
// INPUT TABLE: anliegen
STRUCT anliegen {
  id: INTEGER (PK),
  kategorie_id: INTEGER (FK → categories),
  beschreibung: TEXT,
  ort: VARCHAR(100),
  strasse: VARCHAR(100) | NULL,
  hausnummer: VARCHAR(10) | NULL,
  lat: DECIMAL(10,8) | NULL,
  lng: DECIMAL(11,8) | NULL,
  vorname: VARCHAR(100) | NULL,
  nachname: VARCHAR(100),
  email: VARCHAR(255),
  telefon: VARCHAR(50) | NULL,
  status: ENUM('neu', 'in_bearbeitung', 'erledigt', 'abgelehnt', 'in_redmine', 'fehler_redmine'),
  redmine_id: INTEGER | NULL,
  bearbeitet_am: TIMESTAMP | NULL,
  email_verified: BOOLEAN (DEFAULT: FALSE),
  created_at: TIMESTAMP
}

// OUTPUT UPDATE on success:
UPDATE anliegen 
SET 
  redmine_id = RESPONSE.issue.id,
  status = 'in_redmine',
  bearbeitet_am = CURRENT_TIMESTAMP
WHERE id = anliegen.id
```

---

## 9. API REQUEST/RESPONSE

```
REQUEST:
POST https://redmine.vgo-o.de/issues.json HTTP/1.1
Content-Type: application/json
X-Redmine-API-Key: 5fa5fc504e4958c672d1600172300bc115729969
Content-Length: [bytes]

{
  "issue": { ... }  // see Section 7
}

RESPONSE (201 Created):
{
  "issue": {
    "id": 12345,
    "project": { "id": 93, "name": "..." },
    "tracker": { "id": 20, "name": "..." },
    "status": { "id": 1, "name": "Neu" },
    "subject": "Bürgermeldung: ...",
    "description": "...",
    "created_on": "2026-02-16T10:30:00Z",
    ...
  }
}

RESPONSE (400+ Error):
{
  "errors": [ "Assignee not found", ... ]
}
```

---

## 10. VALIDIERUNGS-WORKFLOW

```
PRE-FLIGHT CHECKS:

1. anliegen.id EXISTS
   ├─ SELECT * FROM anliegen WHERE id = ?
   └─ THROW if NOT FOUND

2. anliegen.kategorie_id VALID
   ├─ Foreign key constraint: categories(id)
   └─ THROW if NOT EXISTS

3. anliegen.email_verified = TRUE
   ├─ required for sync_to_redmine.php
   └─ THROW if FALSE

4. assigneeId RESOLVABLE
   ├─ getAssigneeForCategoryAndLocation(kategorie_id, ort)
   └─ THROW if NULL

5. REQUEST JSON VALID
   ├─ json_encode($issueData) !== false
   └─ THROW on JSON error

6. API RESPONSE VALID
   ├─ HTTP 201 Created
   ├─ response.issue.id EXISTS
   └─ THROW on HTTP error or malformed response

TRANSACTION HANDLING:
  BEGIN TRANSACTION
    ├─ POST to Redmine API
    ├─ IF ERROR: ROLLBACK
    ├─ UPDATE anliegen table
    ├─ IF UPDATE ERROR: ROLLBACK
    └─ COMMIT
```

---

## 11. FEHLERBEHANDLUNG

```php
ENUM IssueCreationError {
  ANLIEGEN_NOT_FOUND,
  CATEGORY_NOT_FOUND,
  ASSIGNEE_NOT_FOUND,
  INVALID_JSON_PAYLOAD,
  INVALID_JSON_RESPONSE,
  HTTP_ERROR,
  API_ERROR,
  DATABASE_ERROR,
  EMAIL_SEND_ERROR  // non-blocking
}

ERROR FLOW:
IF createIssue() throws Exception:
  ├─ Log error with: anliegen.id, kategorie_id, ort, error message
  ├─ ROLLBACK transaction
  ├─ anliegen.status remains as-is OR set to 'fehler_redmine'
  ├─ anliegen.redmine_id remains NULL
  └─ HTTP 500 response with error JSON
```

---

## 12. SYNCH vs PUSH

```
PUSH (push_to_redmine.php):
  - Manual trigger per anliegen
  - Single anliegen.id required
  - Returns immediate HTTP response
  - Creates notification email immediately
  - Used in UI workflows

SYNC (sync_to_redmine.php):
  - Batch processing via cron
  - Finds all unsynced verified entries
  - WHERE status != 'erfolgreich_in_rm'
  - AND email_verified = TRUE
  - Updates status to 'erfolgreich_in_rm' on success
  - Used for background batch operations
```
