import { handler } from './index'; // Importer le handler
import { SESClient, SendEmailCommand, SendEmailCommandInput } from "@aws-sdk/client-ses";
import { mockClient } from 'aws-sdk-client-mock';
import { SNSEvent, SNSEventRecord, SNSMessage, SNSHandler } from 'aws-lambda';

// Simuler le client SES
const sesMock = mockClient(SESClient);

const sesClient = new SESClient({});

describe('EmailSender Lambda Handler', () => {

  // Définir les variables d'environnement avant les tests
  const ORIGINAL_SENDER_EMAIL = process.env.SENDER_EMAIL_ADDRESS;
  const ORIGINAL_RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL_ADDRESS;
  const TEST_SENDER = 'test-sender@example.com';
  const TEST_RECIPIENT = 'test-recipient@example.com';

  beforeAll(() => {
    // S'assurer que les variables sont définies pour tous les tests de ce bloc
    process.env.SENDER_EMAIL_ADDRESS = TEST_SENDER;
    process.env.RECIPIENT_EMAIL_ADDRESS = TEST_RECIPIENT;
  });

  // Réinitialiser le mock SES avant chaque test
  beforeEach(() => {
    sesMock.reset();
  });

  // Restaurer les variables d'environnement après tous les tests
  afterAll(() => {
    process.env.SENDER_EMAIL_ADDRESS = ORIGINAL_SENDER_EMAIL;
    process.env.RECIPIENT_EMAIL_ADDRESS = ORIGINAL_RECIPIENT_EMAIL;
  });

  // Fonction utilitaire pour créer un événement SNS de test
  const createSnsEvent = (messagePayload: object, eventType: string = 'ProductCreated'): SNSEvent => {
    const snsMessage: SNSMessage = {
      Message: JSON.stringify(messagePayload),
      MessageId: 'test-message-id',
      Signature: 'test-signature',
      SignatureVersion: '1',
      SigningCertUrl: 'test-url',
      Subject: 'Test Subject',
      Timestamp: new Date().toISOString(),
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:TestProductEventsTopic',
      Type: 'Notification',
      UnsubscribeUrl: 'test-unsubscribe-url',
      MessageAttributes: {
        eventType: {
          Type: 'String',
          Value: eventType
        }
      }
    };
    const record: SNSEventRecord = {
      EventSource: 'aws:sns',
      EventSubscriptionArn: 'test-subscription-arn',
      EventVersion: '1.0',
      Sns: snsMessage
    };
    return { Records: [record] };
  };

  // --- Cas de Succès --- 
  test('devrait envoyer un email via SES pour un événement ProductCreated valide', async () => {
    // Arrange
    const productPayload = { productId: 'prod-123', name: 'Email Test Product', price: 49.95 };
    const snsEvent = createSnsEvent(productPayload);
    sesMock.on(SendEmailCommand).resolves({ MessageId: 'ses-message-id-success' });

    // Act
    await handler(snsEvent, {} as any, () => {});

    // Assert: Vérifier simplement que SES a été appelé une fois avec la bonne commande
    expect(sesMock.calls()).toHaveLength(1);
    expect(sesMock.call(0).firstArg).toBeInstanceOf(SendEmailCommand);
  });

  // --- Cas d'Ignorer le Message --- 
  test('devrait ignorer le message si eventType n\'est pas ProductCreated', async () => {
    // Arrange
    const productPayload = { productId: 'prod-456', name: 'Other Event Type', price: 10 };
    const snsEvent = createSnsEvent(productPayload, 'ProductUpdated'); 

    // Act
    await handler(snsEvent, {} as any, () => {});

    // Assert: Vérifier que SES n'a pas été appelé
    expect(sesMock.calls()).toHaveLength(0);
  });

  // --- Cas d'Erreurs --- 
  test('devrait gérer une erreur de parsing du message SNS sans planter', async () => {
    // Arrange: Créer un événement avec un message JSON invalide mais une chaîne valide
    const invalidSnsEvent: SNSEvent = { 
        Records: [
            {
                EventSource: 'aws:sns',
                EventSubscriptionArn: 'test-sub',
                EventVersion: '1.0',
                Sns: { 
                    Message: '{', // Dernière tentative: simple accolade ouvrante
                    MessageId: 'invalid-msg-id',
                    Signature: 'sig',
                    SignatureVersion: '1',
                    SigningCertUrl: 'url',
                    Timestamp: new Date().toISOString(),
                    TopicArn: 'arn',
                    Type: 'Notification',
                    UnsubscribeUrl: 'url',
                    MessageAttributes: { eventType: { Type: 'String', Value: 'ProductCreated' } }
                }
            }
        ] 
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); // Mock l'implémentation

    // Act
    await handler(invalidSnsEvent, {} as any, () => {});

    // Assert: Vérifier qu'une erreur a été loguée et que SES n'a pas été appelé
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing SNS message body:'), expect.any(Error));
    expect(sesMock.calls()).toHaveLength(0);

    errorSpy.mockRestore(); // Restaurer la fonction console.error originale
  });

  test('devrait loguer une erreur si SES échoue lors de l\'envoi', async () => {
    // Arrange
    const productPayload = { productId: 'prod-789', name: 'SES Fail Product', price: 99 };
    const snsEvent = createSnsEvent(productPayload);
    const sesError = new Error('SES Send Failed');
    sesMock.on(SendEmailCommand).rejects(sesError); 

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    await handler(snsEvent, {} as any, () => {});

    // Assert
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(`Error sending email for product ${productPayload.productId}:`), sesError);
    // Vérifier que SES a été appelé (même s'il a échoué)
    expect(sesMock.calls()).toHaveLength(1);
    expect(sesMock.call(0).firstArg).toBeInstanceOf(SendEmailCommand);

    errorSpy.mockRestore();
  });

  test('ne devrait pas envoyer d\'email si les variables d\'environnement manquent', async () => {
    // Arrange
    const productPayload = { productId: 'prod-000', name: 'Env Var Missing', price: 5 };
    const snsEvent = createSnsEvent(productPayload);
    // Supprimer temporairement une variable d'environnement
    const originalSender = process.env.SENDER_EMAIL_ADDRESS;
    delete process.env.SENDER_EMAIL_ADDRESS;

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Act
    await handler(snsEvent, {} as any, () => {});

    // Assert: Vérifier qu'une erreur de configuration est loguée et que SES n'est pas appelé
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration error: Missing sender or recipient email address'));
    expect(sesMock.calls()).toHaveLength(0);

    // Restaurer la variable pour ne pas affecter d'autres tests si `afterAll` échoue
    process.env.SENDER_EMAIL_ADDRESS = originalSender; 
    errorSpy.mockRestore();
  });

}); 