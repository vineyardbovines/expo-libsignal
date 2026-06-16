import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import AliceBobScreen from './src/screens/AliceBobScreen'
import GroupsScreen from './src/screens/GroupsScreen'
import IdentityScreen from './src/screens/IdentityScreen'
import PersistenceScreen from './src/screens/PersistenceScreen'
import SealedSenderScreen from './src/screens/SealedSenderScreen'
import SignalClientScreen from './src/screens/SignalClientScreen'

type Tab =
  | 'identity'
  | 'aliceBob'
  | 'persistence'
  | 'groups'
  | 'sealedSender'
  | 'signalClient'

export default function App() {
  const [tab, setTab] = useState<Tab>('identity')
  return (
    <View style={styles.root}>
      <View style={styles.tabBar}>
        <TabButton current={tab} value="identity" label="Identity" onPress={setTab} />
        <TabButton current={tab} value="aliceBob" label="Alice & Bob" onPress={setTab} />
        <TabButton current={tab} value="persistence" label="Persistence" onPress={setTab} />
        <TabButton current={tab} value="groups" label="Groups" onPress={setTab} />
        <TabButton current={tab} value="sealedSender" label="Sealed" onPress={setTab} />
        <TabButton current={tab} value="signalClient" label="Client" onPress={setTab} />
      </View>
      <View style={styles.screen}>{renderScreen(tab)}</View>
    </View>
  )
}

function renderScreen(tab: Tab) {
  switch (tab) {
    case 'identity':
      return <IdentityScreen />
    case 'aliceBob':
      return <AliceBobScreen />
    case 'persistence':
      return <PersistenceScreen />
    case 'groups':
      return <GroupsScreen />
    case 'sealedSender':
      return <SealedSenderScreen />
    case 'signalClient':
      return <SignalClientScreen />
  }
}

function TabButton({
  current,
  value,
  label,
  onPress,
}: {
  current: Tab
  value: Tab
  label: string
  onPress: (t: Tab) => void
}) {
  const active = current === value
  return (
    <Pressable
      onPress={() => onPress(value)}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48, backgroundColor: '#fff' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd' },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabButtonActive: { borderBottomWidth: 2, borderColor: '#333' },
  tabLabel: { fontSize: 14, color: '#666' },
  tabLabelActive: { color: '#000', fontWeight: '600' },
  screen: { flex: 1 },
})
