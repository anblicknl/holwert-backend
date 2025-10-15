import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import Header, { HEADER_HEIGHT } from '../components/Header';
import ApiService from '../services/api';

interface Event {
  id: number;
  title: string;
  description?: string;
  event_date: string;
  end_date?: string;
  location?: string;
  organization_id?: number;
  organization_name?: string;
  organization_brand_color?: string;
  organization_logo?: string;
  price?: string;
  category?: string;
  image_url?: string;
}

interface EventsByMonth {
  [key: string]: Event[];
}

const AgendaScreen: React.FC<{ onSelectEvent?: (event: Event) => void }> = ({ onSelectEvent }) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const { events } = await ApiService.getEvents({ page: 1, limit: 50 });
      setEvents(events || []);
    } catch (error) {
      console.error('Failed to load events:', error);
      Alert.alert('Fout', 'Kon evenementen niet laden');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadEvents();
  };

  const groupEventsByMonth = (events: Event[]): EventsByMonth => {
    const grouped: EventsByMonth = {};
    
    events.forEach(event => {
      const date = new Date(event.event_date);
      const monthKey = date.toLocaleDateString('nl-NL', { 
        month: 'long', 
        year: 'numeric' 
      });
      
      if (!grouped[monthKey]) {
        grouped[monthKey] = [];
      }
      grouped[monthKey].push(event);
    });
    
    return grouped;
  };

  const formatDate = (event: Event) => {
    const startDate = new Date(event.event_date);
    const endDate = event.end_date ? new Date(event.end_date) : null;
    
    const day = startDate.getDate();
    const month = startDate.toLocaleDateString('nl-NL', { month: 'short' }).toUpperCase();
    const year = startDate.getFullYear();
    
    if (endDate && endDate.getTime() !== startDate.getTime()) {
      // Multi-day event
      const endDay = endDate.getDate();
      return { day: `${day}-${endDay}`, month, year, time: null };
    } else {
      // Single day event
      const time = startDate.toLocaleTimeString('nl-NL', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      return { day: day.toString(), month, year, time };
    }
  };

  const addToCalendar = (event: Event) => {
    try {
      const startDate = new Date(event.event_date);
      const endDate = event.end_date ? new Date(event.end_date) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // Default 2 hours
      
      // Format dates for calendar
      const formatDateForCalendar = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };
      
      const startDateStr = formatDateForCalendar(startDate);
      const endDateStr = formatDateForCalendar(endDate);
      
      // Create calendar event details
      const title = encodeURIComponent(event.title);
      const description = encodeURIComponent(event.description || '');
      const location = encodeURIComponent(event.location || '');
      
      // Create calendar URL
      const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDateStr}/${endDateStr}&details=${description}&location=${location}`;
      
      // Open calendar
      Linking.openURL(calendarUrl);
      
      Alert.alert('Toegevoegd', 'Evenement is toegevoegd aan je kalender');
    } catch (error) {
      console.error('Error adding to calendar:', error);
      Alert.alert('Fout', 'Kon evenement niet toevoegen aan kalender');
    }
  };

  const renderEventCard = (event: Event) => {
    const dateInfo = formatDate(event);
    const organizationColor = event.organization_brand_color || Colors.primary.blue;
    
    return (
      <TouchableOpacity key={event.id} style={styles.eventCard} onPress={() => onSelectEvent?.(event)}>
        {/* Date/Time Block */}
        <View style={[styles.dateBlock, { backgroundColor: organizationColor }]}>
          <Text style={styles.dateDay}>{dateInfo.day}</Text>
          {dateInfo.time && <Text style={styles.dateTime}>{dateInfo.time}</Text>}
          <Text style={styles.dateMonth}>{dateInfo.month}</Text>
          <Text style={styles.dateYear}>{dateInfo.year}</Text>
        </View>

        {/* Image Block */}
        <View style={styles.imageBlock}>
          {event.image_url ? (
            <Image 
              source={{ uri: event.image_url }} 
              style={styles.eventImage} 
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="calendar-outline" size={32} color={Colors.text.tertiary} />
            </View>
          )}
        </View>

        {/* Content Block */}
        <View style={styles.contentBlock}>
          <View style={styles.titleRow}>
            <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
            <TouchableOpacity 
              style={[styles.calendarButton, { backgroundColor: organizationColor }]}
              onPress={(e) => {
                e.stopPropagation();
                addToCalendar(event);
              }}
            >
              <Ionicons name="calendar-outline" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.eventDescription} numberOfLines={2}>
            {event.description || 'Geen beschrijving beschikbaar'}
          </Text>
          
          {event.location && (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={14} color={Colors.text.tertiary} />
              <Text style={styles.infoText}>{event.location}</Text>
            </View>
          )}
          
          {event.organization_name && (
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={14} color={Colors.text.tertiary} />
              <Text style={styles.infoText}>{event.organization_name}</Text>
            </View>
          )}
          
          {event.end_date && (
            <View style={styles.infoRow}>
              <Ionicons name="calendar-outline" size={14} color={Colors.text.tertiary} />
              <Text style={styles.infoText}>Meerdaags evenement</Text>
            </View>
          )}
          
          <View style={styles.priceRow}>
            <TouchableOpacity style={styles.priceButton}>
              <Text style={styles.priceText}>{event.price || 'Gratis'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Header title="Agenda" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary.blue} />
          <Text style={styles.loadingText}>Evenementen laden...</Text>
        </View>
      </View>
    );
  }

  const groupedEvents = groupEventsByMonth(events);

  return (
    <View style={styles.container}>
      <Header title="Agenda" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[Colors.primary.blue]}
            tintColor={Colors.primary.blue}
          />
        }
      >
        {Object.keys(groupedEvents).length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="calendar-outline" size={64} color={Colors.text.tertiary} />
            <Text style={styles.emptyTitle}>Geen evenementen</Text>
            <Text style={styles.emptyText}>Er zijn momenteel geen evenementen gepland.</Text>
          </View>
        ) : (
          Object.entries(groupedEvents).map(([month, monthEvents]) => (
            <View key={month} style={styles.monthSection}>
              <Text style={styles.monthTitle}>{month}</Text>
              {monthEvents.map(renderEventCard)}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: HEADER_HEIGHT + 20,
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: HEADER_HEIGHT,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: Colors.text.secondary,
    fontFamily: Colors.fonts.medium,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text.primary,
    marginTop: 16,
    marginBottom: 8,
    fontFamily: Colors.fonts.bold,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.text.secondary,
    textAlign: 'center',
    fontFamily: Colors.fonts.regular,
  },
  monthSection: {
    marginBottom: 24,
  },
  monthTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text.primary,
    marginBottom: 16,
    fontFamily: Colors.fonts.bold,
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    height: 120,
  },
  dateBlock: {
    width: 80,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: Colors.fonts.bold,
  },
  dateTime: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 4,
    fontFamily: Colors.fonts.medium,
  },
  dateMonth: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 4,
    fontFamily: Colors.fonts.medium,
  },
  dateYear: {
    fontSize: 12,
    color: '#FFFFFF',
    marginTop: 2,
    fontFamily: Colors.fonts.medium,
  },
  imageBlock: {
    width: 80,
    height: '100%',
    overflow: 'hidden',
  },
  eventImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.background.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentBlock: {
    flex: 1,
    padding: 16,
    justifyContent: 'space-between',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text.primary,
    flex: 1,
    marginRight: 8,
    fontFamily: Colors.fonts.bold,
  },
  calendarButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  eventDescription: {
    fontSize: 14,
    color: Colors.text.secondary,
    lineHeight: 18,
    marginBottom: 8,
    fontFamily: Colors.fonts.regular,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  infoText: {
    fontSize: 12,
    color: Colors.text.tertiary,
    fontFamily: Colors.fonts.regular,
  },
  priceRow: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  priceButton: {
    backgroundColor: Colors.background.light,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  priceText: {
    fontSize: 12,
    color: Colors.text.secondary,
    fontWeight: '600',
    fontFamily: Colors.fonts.semiBold,
  },
});

export default AgendaScreen;
