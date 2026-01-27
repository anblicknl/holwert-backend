# ⚡ Backend Performance Optimalisatie Plan

## 📊 Huidige Situatie
- Backend draait op Vercel (Node.js)
- Database via PHP proxy (shared hosting)
- Er is al caching, maar kan beter
- Batch queries zijn beschikbaar maar niet gebruikt

## 🎯 Quick Wins (1-2 uur werk, 30-50% sneller)

### 1. Batch Queries Gebruiken
**Huidig**: Meerdere aparte requests naar PHP proxy
**Optimalisatie**: Combineer queries in één batch request

**Voorbeeld - Events endpoint:**
```javascript
// Huidig: 2 aparte requests
const [proxyRes, proxyCountRes] = await Promise.all([...]);

// Optimalisatie: 1 batch request
const batchResults = await executeBatchQueries([
  { query: 'SELECT ...', params: [...], action: 'execute' },
  { query: 'SELECT COUNT(*) ...', params: [...], action: 'execute' }
]);
```

**Impact**: 30-40% sneller (minder network overhead)

### 2. Cache TTL Verhogen
**Huidig**: 5 minuten voor news/events
**Optimalisatie**: 10-15 minuten voor read-only data

**Impact**: Minder database queries, snellere responses

### 3. Response Compression Optimaliseren
**Huidig**: Al aanwezig, maar kan beter
**Optimalisatie**: Betere compressie settings

**Impact**: 20-30% kleinere responses

## 🚀 Medium Wins (2-4 uur werk, 40-60% sneller)

### 4. Database Indexen Toevoegen
```sql
-- Voeg indexen toe voor veelgebruikte queries
CREATE INDEX idx_news_published_date ON news(is_published, published_at);
CREATE INDEX idx_events_date_org ON events(event_date, organization_id);
CREATE INDEX idx_organizations_approved ON organizations(is_approved);
```

**Impact**: 50-70% snellere queries

### 5. Query Optimalisatie
- Gebruik SELECT specifieke kolommen (niet *)
- Voeg LIMIT toe waar mogelijk
- Gebruik JOINs in plaats van N+1 queries

**Impact**: 30-50% snellere queries

### 6. Parallel Processing
**Huidig**: Sommige queries zijn al parallel
**Optimalisatie**: Meer endpoints parallel maken

**Impact**: 20-30% sneller voor endpoints met meerdere queries

## 🔥 Advanced Wins (4-8 uur werk, 60-80% sneller)

### 7. Redis Cache Toevoegen
**Huidig**: In-memory cache (verliest data bij restart)
**Optimalisatie**: Redis voor persistent cache

**Impact**: 70-80% sneller voor cached responses

### 8. Database Connection Pooling
**Huidig**: PHP proxy gebruikt persistent connections
**Optimalisatie**: Betere pooling strategie

**Impact**: 20-30% sneller voor database queries

### 9. Query Result Caching in PHP Proxy
**Huidig**: File-based cache
**Optimalisatie**: Memory cache (APCu) voor snellere access

**Impact**: 40-50% sneller voor cached queries

## 📈 Verwachte Resultaten

### Na Quick Wins:
- **API Response tijd**: 500-1000ms → **300-600ms** (40-50% sneller)
- **Database queries**: 200-500ms → **100-300ms** (50% sneller)

### Na Medium Wins:
- **API Response tijd**: 300-600ms → **150-300ms** (50-70% sneller)
- **Database queries**: 100-300ms → **50-150ms** (50-70% sneller)

### Na Advanced Wins:
- **API Response tijd**: 150-300ms → **50-150ms** (70-80% sneller)
- **Cached responses**: **<50ms** (90%+ sneller)

## 🛠️ Implementatie Prioriteit

1. **Batch Queries** (hoogste impact, snelste implementatie)
2. **Cache TTL verhogen** (zeer snel, goede impact)
3. **Database indexen** (goede impact, medium werk)
4. **Query optimalisatie** (medium impact, medium werk)
5. **Redis cache** (grootste impact, meeste werk)
