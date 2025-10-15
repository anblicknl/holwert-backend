import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, Image, RefreshControl, TouchableOpacity, Share, StyleSheet, Animated, Dimensions, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { get, post, del } from '../api/client';
import ApiService from '../services/api';
import { useFollow } from '../contexts/FollowContext';
import { getTextColor } from '../utils/colorUtils';

type NewsVariants = { original?: string; full?: string; large?: string; medium?: string; thumbnail?: string };
type Organization = { id?: number; name?: string; logo_url?: string };
type NewsItem = {
  id: number;
  title: string;
  content: string;
  excerpt?: string;
  created_at: string;
  image_url?: string;
  image_variants?: NewsVariants;
  organization_id?: number;
  organization_name?: string;
  organization_logo?: string;
  organization_brand_color?: string;
};

export default function NewsDetailScreen({ route, navigation, onSelectOrganization }: any) {
  const { id } = route.params;
  const [data, setData] = useState<NewsItem | null>(null);
  const [related, setRelated] = useState<NewsItem[]>([]);
  const [bookmarked, setBookmarked] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [organizationsMap, setOrganizationsMap] = useState<Map<string, number>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroHeight = Dimensions.get('window').height * 0.4;

  const loadOrganizations = useCallback(async () => {
    try {
      const response = await ApiService.get('/organizations');
      if (response.success && response.data?.organizations) {
        const map = new Map<string, number>();
        response.data.organizations.forEach((org: any) => {
          map.set(org.name, org.id);
        });
        setOrganizationsMap(map);
        console.log('NewsDetailScreen: Organizations map loaded:', map);
      }
    } catch (error) {
      console.error('NewsDetailScreen: Error loading organizations:', error);
    }
  }, []);
  const hero = useMemo(() => data?.image_variants?.large || data?.image_url, [data]);
  const [newsCount, setNewsCount] = useState<number | undefined>(undefined);
  const [followersCount, setFollowersCount] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const detail = await get<{ article: NewsItem }>(`/news/${id}`);
      setData(detail.article);
      if (detail.article.organization_id) {
        const rel = await get<{ news: NewsItem[] }>(`/news/related?organization_id=${detail.article.organization_id}&exclude=${detail.article.id}&limit=8`);
        setRelated(rel.news);
        // tel aantal artikelen voor deze organisatie (zonder dummy). Gebruik een grotere limit zodat we de teller kunnen tonen
        try {
          const all = await get<{ news: NewsItem[] }>(`/news/related?organization_id=${detail.article.organization_id}&limit=999`);
          setNewsCount((all.news || []).length);
        } catch {}
        // aantal volgers (totaal) – echte API
        try {
          const fc = await get<{ count: number }>(`/organizations/${detail.article.organization_id}/followers/count`);
          setFollowersCount(fc.count);
          // Update the context with the followers count
          updateFollowersCount(detail.article.organization_id, fc.count);
        } catch {}
        // following state (alleen voor huidige gebruiker)
        try {
          const f = await get<{ following: boolean }>(`/app/following/${detail.article.organization_id}`);
          // We can store following on bookmarked state or create separate state
          // Keep separate: reuse bookmarked only for bookmarks; add separate follow state
        } catch {}
      } else {
        setRelated([]);
      }
      // bookmark state
      try {
        const status = await get<{ bookmarked: boolean }>(`/app/bookmarks/${id}`);
        setBookmarked(!!status.bookmarked);
      } catch { setBookmarked(false); }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { 
    load(); 
    loadOrganizations(); 
  }, [load, loadOrganizations]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const toggleBookmark = async () => {
    const token = await AsyncStorage.getItem('authToken');
    if (!token) { navigation.navigate('Login'); return; }
    try {
      if (bookmarked) {
        await del(`/app/bookmarks/${id}`);
        setBookmarked(false);
      } else {
        await post('/app/bookmarks', { news_id: id });
        setBookmarked(true);
      }
    } catch (e: any) {
      console.warn('Bookmark error', e?.message || e);
    }
  };

  const { isFollowing, toggleFollow, getFollowersCount, updateFollowersCount } = useFollow();

  const shareItem = async () => {
    try {
      await Share.share({ message: `${data?.title}\nhttps://holwert.nl/news/${id}` });
    } catch {}
  };

  if (loading && !data) return <View style={styles.center}><Text>Bezig met laden…</Text></View>;
  if (!data) return <View style={styles.center}><Text>Niet gevonden</Text></View>;

  // Get organization brand color
  const brandColor = data.organization_brand_color;
  const organizationColor = (typeof brandColor === 'string' && brandColor.length > 0 
    ? brandColor 
    : '#2f6cf6'); // Default blue

  return (
    <View style={{ flex:1 }}>
      {/* Fixed overlay header: back button + page name pill + share button (rechts) */}
      <View style={styles.fixedHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.pageNamePill}>
          <Text style={styles.pageNameText}>Nieuws</Text>
        </View>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.shareButton} onPress={shareItem}>
          <Ionicons name="share-outline" size={20} color="#000" />
        </TouchableOpacity>
      </View>
      <Animated.ScrollView 
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      > 
        <View style={{ paddingTop: (Platform.OS === 'ios' ? 100 : 80) }}>
          <Animated.View 
            style={[styles.heroWrap, {
              transform: [{
                translateY: scrollY.interpolate({
                  inputRange: [-heroHeight, 0, heroHeight * 2],
                  outputRange: [-heroHeight * 0.3, 0, heroHeight],
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })
              }]
            }]}
          >
            {hero ? <Image source={{ uri: hero }} style={styles.hero} /> : null}
            {/* Bookmark FAB half over hero / content */}
            <TouchableOpacity onPress={toggleBookmark} style={[styles.iconBtnFabOverlay, bookmarked && { backgroundColor: organizationColor + '20', borderColor: organizationColor }]}>
              <Ionicons name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={20} color={bookmarked ? organizationColor : '#334'} />
            </TouchableOpacity>
          </Animated.View>
        </View>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={[styles.category, { color: organizationColor }]}>Het Dorp</Text>
            <Text style={styles.date}>{new Date(data.created_at).toLocaleDateString('nl-NL', { day:'2-digit', month:'short', year:'numeric' })}</Text>
          </View>
          <Text style={styles.title}>{data.title}</Text>
          <Text style={styles.body}>{data.content}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: organizationColor }]} onPress={shareItem}>
            <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Delen</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.subheading}>Geplaatst door:</Text>
          <TouchableOpacity 
            style={styles.orgCard}
            onPress={() => {
              let orgId = data.organization_id;
              if (!orgId && data.organization_name) {
                orgId = organizationsMap.get(data.organization_name);
                console.log('NewsDetailScreen: Found organization ID from name:', orgId);
              }
              if (onSelectOrganization && orgId) {
                onSelectOrganization(orgId);
              }
            }}
          >
            {data.organization_logo ? <Image source={{ uri: data.organization_logo }} style={styles.orgLogo} /> : <View style={styles.orgLogoPlaceholder} />}
            <View style={{ flex:1 }}>
              <Text style={styles.orgName}>{data.organization_name || '—'}</Text>
              {/* stats: alleen iconen + getallen uit de API (geen dummy labels) */}
              <View style={{ flexDirection:'row', alignItems:'center', gap:16 }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                  <Ionicons name="newspaper-outline" size={14} color="#667" />
                  <Text style={styles.orgMeta}>{typeof newsCount === 'number' ? newsCount : 0}</Text>
                </View>
                <View style={{ flexDirection:'row', alignItems:'center', gap:6 }}>
                  <Ionicons name="people-outline" size={14} color="#667" />
                  <Text style={styles.orgMeta}>{getFollowersCount(data.organization_id || 0)}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.followBtn, isFollowing(data.organization_id || 0) && { backgroundColor: organizationColor }]}
              onPress={async () => {
                const orgId = data.organization_id;
                if (!orgId) { 
                  console.log('No organization ID available for follow action');
                  return; 
                }
                try {
                  await toggleFollow(orgId);
                } catch (e: any) { 
                  console.warn('Follow toggle error', e?.message || e); 
                }
              }}
            >
              <Text style={[styles.followText, { color: isFollowing(data.organization_id || 0) ? getTextColor(organizationColor) : '#374151' }]}>{isFollowing(data.organization_id || 0) ? 'Volgend' : 'Volgen'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
          {/* bookmark FAB is verplaatst naar hero overlay */}
        </View>
        {related.length > 0 && (
          <View style={styles.card}> 
            <Text style={styles.subheading}>Meer nieuws van deze organisatie</Text>
            {related.map(item => (
              <TouchableOpacity key={item.id} style={styles.relatedItem} onPress={() => navigation.push('NewsDetail', { id: item.id })}>
                {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.relatedThumb} /> : <View style={styles.relatedThumbPlaceholder} />}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={styles.relatedTitle}>{item.title}</Text>
                  <Text style={styles.relatedDate}>{new Date(item.created_at).toLocaleDateString('nl-NL')}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fixedHeader: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 20,
    right: 20,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  pageNamePill: {
    marginLeft: 12,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  pageNameText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    marginLeft: 12,
  },
  center: { flex:1, alignItems:'center', justifyContent:'center' },
  hero: { width: '100%', height: 360 },
  heroWrap: { position:'relative' },
  iconBtnFabOverlay: { position:'absolute', right: 16, bottom: -22, width:48, height:48, borderRadius:24, alignItems:'center', justifyContent:'center', backgroundColor:'#fff', borderWidth:1, borderColor:'#dbe1f0', shadowColor:'#000', shadowOpacity:0.08, shadowRadius:14 },
  iconBtnFabOverlayActive: { backgroundColor:'#eef4ff', borderColor:'#2f6cf6' },
  card: { margin: 16, padding: 16, borderRadius: 16, backgroundColor: '#fff', shadowColor:'#000', shadowOpacity:0.06, shadowRadius:12 },
  headerRow: { flexDirection:'row', justifyContent:'space-between', marginBottom: 8 },
  category: { fontWeight:'600' },
  date: { color:'#778', fontSize:12 },
  title: { fontSize:24, fontWeight:'700', marginVertical:8 },
  body: { color:'#334', lineHeight:22 },
  primaryBtn: { borderRadius:12, paddingVertical:12, alignItems:'center', marginVertical:12 },
  primaryBtnText: { color:'#fff', fontWeight:'600' },
  subheading: { fontWeight:'700', marginTop:8, marginBottom:8 },
  orgCard: { flexDirection:'row', alignItems:'center', gap:12, padding:12, borderRadius:12, backgroundColor:'#f6f8ff' },
  orgLogo: { width:48, height:48, borderRadius:12 },
  orgLogoPlaceholder: { width:48, height:48, borderRadius:12, backgroundColor:'#eef' },
  orgName: { fontWeight:'700' },
  orgMeta: { color:'#889' },
  followBtn: { paddingHorizontal:14, paddingVertical:8, backgroundColor:'#e5e7eb', borderRadius:12 },
  followText: { color:'#374151', fontWeight:'600' },
  actionsRow: { flexDirection:'row', gap:12, marginTop:12 },
  iconBtnFab: { width:44, height:44, borderRadius:22, alignItems:'center', justifyContent:'center', backgroundColor:'#fff', borderWidth:1, borderColor:'#dbe1f0', shadowColor:'#000', shadowOpacity:0.06, shadowRadius:12 },
  iconBtnFabActive: { backgroundColor:'#eef4ff', borderColor:'#2f6cf6' },
  relatedItem: { flexDirection:'row', gap:12, alignItems:'center', marginVertical:8 },
  relatedThumb: { width:64, height:48, borderRadius:8, backgroundColor:'#eee' },
  relatedThumbPlaceholder: { width:64, height:48, borderRadius:8, backgroundColor:'#eee' },
  relatedTitle: { fontWeight:'600' },
  relatedDate: { color:'#889', fontSize:12 },
});


