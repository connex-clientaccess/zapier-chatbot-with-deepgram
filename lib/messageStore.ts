type StoredMessage = {
  message: string;
  timestamp: string;
  consumed: boolean;
};

export const messageStore = new Map<string, StoredMessage>();
