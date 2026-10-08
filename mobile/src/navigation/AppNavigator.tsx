import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Colors } from '../constants/Colors';
import OrganizationsScreen from '../screens/OrganizationsScreen';
import OrganizationDetailScreen from '../screens/OrganizationDetailScreen';
import Header from '../components/Header';
import BottomNavigation from '../components/BottomNavigation';
import NewsScreen from '../screens/NewsScreen';
import AgendaScreen from '../screens/AgendaScreen';
import EventDetailScreen from '../screens/EventDetailScreen';
import HetDorpScreen from '../screens/HetDorpScreen';
import NewsDetailScreen from '../screens/NewsDetailScreen';
import { FollowProvider } from '../contexts/FollowContext';

type TabName = 'News' | 'Agenda' | 'HetDorp' | 'Organizations';

const AppNavigator: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabName>('News');
  const [selectedNewsId, setSelectedNewsId] = useState<number | null>(null);
  const [selectedOrganization, setSelectedOrganization] = useState<any>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  // Auto-switch to Organizations tab when selectedOrganizationId is set
  React.useEffect(() => {
    if (selectedOrganizationId !== null) {
      setActiveTab('Organizations');
    }
  }, [selectedOrganizationId]);

  const renderScreen = () => {
    switch (activeTab) {
      case 'News':
        return <NewsScreen onOpenArticle={(id) => setSelectedNewsId(id)} onSelectOrganization={(id) => {
          console.log('AppNavigator: onSelectOrganization called with:', id);
          setSelectedOrganizationId(id);
        }} />;
      case 'Agenda':
        return <AgendaScreen onSelectEvent={(event) => setSelectedEvent(event)} />;
      case 'HetDorp':
        return <HetDorpScreen />;
      case 'Organizations':
        return (
          <OrganizationsScreen 
            navigation={{ navigate: () => {} }} 
            onSelectOrganization={(org) => {
              setSelectedOrganization(org);
              setSelectedOrganizationId(null); // Reset after selection
            }}
            selectedOrganizationId={selectedOrganizationId}
          />
        );
      default:
        return <NewsScreen />;
    }
  };

  return (
    <FollowProvider>
      <View style={styles.container}>
        {renderScreen()}
        <BottomNavigation
          activeTab={activeTab}
          onTabPress={(tabName) => setActiveTab(tabName as TabName)}
        />

        {selectedNewsId !== null && (
          <View style={styles.overlay}>
            <NewsDetailScreen
              route={{ params: { id: selectedNewsId } }}
              navigation={{
                navigate: (_: string) => {},
                push: (_: string, params: any) => setSelectedNewsId(params?.id),
                goBack: () => setSelectedNewsId(null),
              }}
              onSelectOrganization={(id: number) => setSelectedOrganizationId(id)}
            />
          </View>
        )}

        {selectedEvent !== null && (
          <View style={styles.overlay}>
            <EventDetailScreen
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
              onSelectOrganization={(organizationId: number) => {
                setSelectedEvent(null);
                setSelectedOrganizationId(organizationId);
              }}
              fromPage="Agenda"
            />
          </View>
        )}

        {selectedOrganization !== null && (
          <View style={styles.overlay}>
            <OrganizationDetailScreen
              organization={selectedOrganization}
              onClose={() => setSelectedOrganization(null)}
              onSelectNews={(newsId: number) => {
                setSelectedOrganization(null);
                setSelectedNewsId(newsId);
              }}
            />
          </View>
        )}

      </View>
    </FollowProvider>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background,
    zIndex: 99999,
  },
});

export default AppNavigator;
