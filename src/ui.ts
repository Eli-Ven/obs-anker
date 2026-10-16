import { App, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
export const report = (error: unknown) =>
  new Notice(error instanceof Error ? error.message : String(error), 7000);
export function run(action: () => Promise<unknown>): void {
  void action().catch(report);
}
export class Pick<T> extends FuzzySuggestModal<T> {
  constructor(
    app: App,
    readonly items: T[],
    readonly label: (item: T) => string,
    readonly choose: (item: T) => void,
    title: string,
  ) {
    super(app);
    this.setPlaceholder(title);
  }
  getItems(): T[] {
    return this.items;
  }
  getItemText(item: T): string {
    return this.label(item);
  }
  onChooseItem(item: T): void {
    this.choose(item);
  }
}
export interface Field {
  key: string;
  label: string;
  value?: string;
  type?: string;
  placeholder?: string;
}
export class Form extends Modal {
  constructor(
    app: App,
    readonly heading: string,
    readonly fields: Field[],
    readonly submit: (values: Record<string, string>) => Promise<void>,
    readonly action = "保存",
    readonly enterToSubmit = false,
  ) {
    super(app);
  }
  onOpen(): void {
    this.setTitle(this.heading);
    const values: Record<string, string> = {};
    let submitButton: HTMLButtonElement;
    for (const field of this.fields) {
      values[field.key] = field.value || "";
      new Setting(this.contentEl).setName(field.label).addText((input) => {
        input
          .setValue(values[field.key])
          .setPlaceholder(field.placeholder || "")
          .onChange((value) => {
            values[field.key] = value;
          });
        input.inputEl.type = field.type || "text";
        if (this.enterToSubmit) {
          input.inputEl.addEventListener("keydown", (event) => {
            if (
              event.key !== "Enter" ||
              event.isComposing ||
              event.keyCode === 229 ||
              event.repeat ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.shiftKey
            )
              return;
            event.preventDefault();
            submitButton.click();
          });
        }
      });
    }
    new Setting(this.contentEl).addButton((button) => {
      submitButton = button.buttonEl;
      button
        .setButtonText(this.action)
        .setCta()
        .onClick(() => {
          button.setDisabled(true);
          void this.submit(values)
            .then(() => this.close())
            .catch(report)
            .finally(() => {
              // Obsidian components are thenables; never return one to a Promise.
              button.setDisabled(false);
            });
        });
    });
  }
  onClose(): void {
    this.contentEl.empty();
  }
}
