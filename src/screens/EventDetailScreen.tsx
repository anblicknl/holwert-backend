import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  RefreshControl, ActivityIndicator, Alert, Linking, Platform, StatusBar, Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import ApiService from '../services/api';
import { useFollow } from '../contexts/FollowContext';
import { getTextColor } from '../utils/colorUtils';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface Event {
  id: number;
  title: string;
  description?: string;
  event_date: string;
  end_date?: string;
  location?: string;
  location_details?: string;
  organization_id?: number;
  organization_name?: string;
  organization_brand_color?: string;
  organization_logo?: string;
  price?: string;
  category?: string;
  image_url?: string;
  organizer_id?: number;
  organizer_first_name?: string;
  organizer_last_name?: string;
}

interface EventDetailScreenProps {
  event: Event;
  onClose: () => void;
  onSelectOrganization: (organizationId: number) => void;
}

export default function EventDetailScreen({ event: initialEvent, onClose, onSelectOrganization }: EventDetailScreenProps) {
  const [event, setEvent] = useState<Event>(initialEvent);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { isFollowing, toggleFollow, getFollowersCount } = useFollow();

  const organizationColor = event?.organization_brand_color || Colors.primary.blue;
  const isOrgFollowing = event?.organization_id ? isFollowing(event.organization_id) : false;
  const followersCount = event?.organization_id ? getFollowersCount(event.organization_id) : 0;

  const fetchEventDetails = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await ApiService.getEvent(event?.id || initialEvent.id);
      if (response.event) {
        setEvent(response.event);
      }
    } catch (error) {
      console.error('Error fetching event details:', error);
      Alert.alert('Fout', 'Kon evenementdetails niet laden');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [event?.id, initialEvent.id]);

  useEffect(() => {
    fetchEventDetails();
  }, [fetchEventDetails]);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchEventDetails();
  }, [fetchEventDetails]);

  const handleFollowToggle = async () => {
    if (event?.organization_id) {
      try {
        await toggleFollow(event.organization_id);
      } catch (error) {
        console.error('Error toggling follow:', error);
        Alert.alert('Fout', 'Kon actie niet uitvoeren');
      }
    }
  };

  const openMaps = () => {
    if (event?.location) {
      const scheme = Platform.select({ ios: 'maps:0,0?q=', android: 'geo:0,0?q=' });
      const latLng = ''; // You might need to fetch lat/lng for the location
      const label = encodeURIComponent(event.location);
      const url = Platform.select({
        ios: `${scheme}${label}@${latLng}`,
        android: `${scheme}${latLng}(${label})`
      });
      if (url) {
        Linking.openURL(url);
      }
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  };

  if (isLoading || !event) {
    return (
      <View style={styles.container}>
        <Header title="Evenement" showBackButton onBackPress={onClose} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary.blue} />
          <Text style={styles.loadingText}>Evenement laden...</Text>
        </View>
      </View>
    );
  }

      return (
        <View style={styles.container}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          
          {/* Hero Section with Back Button */}
          <View style={styles.heroSection}>
            {event?.image_url ? (
              <Image source={{ uri: event.image_url }} style={styles.heroImage} />
            ) : (
              <View style={[styles.heroPlaceholder, { backgroundColor: organizationColor }]}>
                <Ionicons name="calendar-outline" size={80} color="#FFFFFF" />
              </View>
            )}
            
            {/* Back Button - Fixed position */}
            <TouchableOpacity style={styles.backButton} onPress={onClose}>
              <Ionicons name="chevron-back" size={24} color="#000" />
            </TouchableOpacity>
            
            {/* Event Title and Meta Info over Hero */}
            <View style={styles.heroContent}>
              <Text style={styles.heroTitle}>{event?.title || 'Evenement'}</Text>
              <View style={styles.heroMeta}>
                <View style={styles.metaItem}>
                  <Ionicons name="calendar-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.metaText}>
                    {event?.event_date ? new Date(event.event_date).toLocaleDateString('nl-NL', { 
                      weekday: 'short', 
                      day: 'numeric', 
                      month: 'short' 
                    }) : ''}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="time-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.metaText}>
                    {event?.event_date ? formatTime(event.event_date) : ''}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <Ionicons name="location-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.metaText}>{event?.location || ''}</Text>
                </View>
              </View>
            </View>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                colors={[organizationColor]}
                tintColor={organizationColor}
              />
            }
          >
            {/* About Event Tile */}
            {event?.description && (
              <View style={styles.contentTile}>
                <Text style={styles.tileTitle}>Over dit evenement</Text>
                <Text style={styles.tileText}>{event.description}</Text>
              </View>
            )}

            {/* Organization Tile */}
            {event?.organization_id && (
              <TouchableOpacity style={styles.contentTile} onPress={() => onSelectOrganization(event.organization_id!)}>
                <Text style={styles.tileTitle}>Georganiseerd door</Text>
                <View style={styles.orgInfo}>
                  {event?.organization_logo ? (
                    <Image source={{ uri: event.organization_logo }} style={styles.orgLogo} />
                  ) : (
                    <View style={[styles.orgLogoPlaceholder, { backgroundColor: organizationColor }]}>
                      <Ionicons name="business" size={24} color="#FFFFFF" />
                    </View>
                  )}
                  <View style={styles.orgTextContainer}>
                    <Text style={styles.orgName}>{event?.organization_name || ''}</Text>
                    <Text style={styles.orgCategory}>{event?.category || ''}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.followButton,
                      { backgroundColor: isOrgFollowing ? organizationColor : Colors.background.light }
                    ]}
                    onPress={handleFollowToggle}
                  >
                    <Ionicons
                      name={isOrgFollowing ? "checkmark" : "add"}
                      size={16}
                      color={isOrgFollowing ? getTextColor(organizationColor) : Colors.text.secondary}
                    />
                    <Text style={[
                      styles.followButtonText,
                      { color: isOrgFollowing ? getTextColor(organizationColor) : Colors.text.secondary }
                    ]}>
                      {isOrgFollowing ? "Volgend" : "Volgen"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}

            {/* Location Details Tile */}
            {event?.location_details && (
              <View style={styles.contentTile}>
                <Text style={styles.tileTitle}>Locatie details</Text>
                <Text style={styles.tileText}>{event.location_details}</Text>
              </View>
            )}

            {/* Event Details Tile */}
            {(event?.price || event?.max_attendees) && (
              <View style={styles.contentTile}>
                <Text style={styles.tileTitle}>Details</Text>
                {event?.price && (
                  <View style={styles.detailRow}>
                    <Ionicons name="pricetag-outline" size={18} color={Colors.text.secondary} />
                    <Text style={styles.detailText}>Prijs: {event.price === '0.00' ? 'Gratis' : `€${event.price}`}</Text>
                  </View>
                )}
                {event?.max_attendees && (
                  <View style={styles.detailRow}>
                    <Ionicons name="people-outline" size={18} color={Colors.text.secondary} />
                    <Text style={styles.detailText}>Max. deelnemers: {event.max_attendees}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Action Button */}
            {event?.location && (
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: organizationColor }]} 
                onPress={openMaps}
              >
                <Ionicons name="map-outline" size={20} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>Bekijk locatie</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: Colors.text.secondary,
  },
  // Hero Section
  heroSection: {
    height: screenHeight * 0.45,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 20,
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
    zIndex: 10,
  },
  heroContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  metaText: {
    fontSize: 14,
    color: '#FFFFFF',
    marginLeft: 6,
    fontWeight: '500',
  },
  // Scroll View
  scrollView: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  // Content Tiles
  contentTile: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  tileTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text.primary,
    marginBottom: 12,
  },
  tileText: {
    fontSize: 16,
    color: Colors.text.secondary,
    lineHeight: 24,
  },
  // Organization Info
  orgInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  orgLogo: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  orgLogoPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgTextContainer: {
    flex: 1,
  },
  orgName: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text.primary,
  },
  orgCategory: {
    fontSize: 14,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  followButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginLeft: 15,
  },
  followButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 5,
  },
  // Details
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailText: {
    fontSize: 16,
    color: Colors.text.secondary,
    marginLeft: 10,
  },
  // Action Button
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
    marginLeft: 10,
  },
});


