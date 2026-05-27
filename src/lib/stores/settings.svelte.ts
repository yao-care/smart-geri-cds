import { getTenantSettings, saveTenantSettings } from '../db/tenant-settings';
import { getTenantId } from '../utils/tenant';

class SettingsStore {
  tenantId = $state('default');
  displayName = $state('預設（未連線）');
  pollingInterval = $state(30);
  advisoryBatchInterval = $state(5);
  browserNotifications = $state(true);
  soundEnabled = $state(true);
  alertAfterHours = $state(24);
  customRulesYaml = $state<string | undefined>(undefined);
  isLoaded = $state(false);

  async setTenant(fhirBaseUrl: string | null): Promise<void> {
    this.tenantId = getTenantId(fhirBaseUrl);
    await this.load(fhirBaseUrl);
  }

  async load(fhirBaseUrl: string | null = null): Promise<void> {
    try {
      const settings = await getTenantSettings(this.tenantId, fhirBaseUrl);
      this.displayName = settings.displayName;
      this.pollingInterval = settings.pollingInterval;
      this.advisoryBatchInterval = settings.advisoryBatchInterval;
      this.browserNotifications = settings.browserNotifications;
      this.soundEnabled = settings.soundEnabled;
      this.alertAfterHours = settings.alertAfterHours;
      this.customRulesYaml = settings.customRulesYaml;
    } catch {
      // Use defaults
    }
    this.isLoaded = true;
  }

  async save(): Promise<void> {
    await saveTenantSettings({
      id: this.tenantId,
      tenantId: this.tenantId,
      displayName: this.displayName,
      pollingInterval: this.pollingInterval,
      advisoryBatchInterval: this.advisoryBatchInterval,
      browserNotifications: this.browserNotifications,
      soundEnabled: this.soundEnabled,
      alertAfterHours: this.alertAfterHours,
      customRulesYaml: this.customRulesYaml,
      updatedAt: new Date(),
    });
  }

  reset(): void {
    this.pollingInterval = 30;
    this.advisoryBatchInterval = 5;
    this.browserNotifications = true;
    this.soundEnabled = true;
    this.alertAfterHours = 24;
    this.customRulesYaml = undefined;
  }
}

export const settingsStore = new SettingsStore();
