import SwiftUI
import WidgetKit

/// Days counter widgets (home screen + lock screen). Reads the
/// `countdowns` array the app keeps in the App Group state document and
/// shows the soonest one that is today or later — the same rule as
/// src/lib/countdowns.ts nextCountdown(). The app calls
/// WidgetCenter.reloadAllTimelines() whenever countdowns change; the
/// timeline also rolls over at every local midnight.
struct CountdownEntry: TimelineEntry {
  let date: Date
  let title: String?
  let target: Date?

  var daysLeft: Int? {
    guard let target else { return nil }
    let cal = Calendar.current
    return cal.dateComponents(
      [.day],
      from: cal.startOfDay(for: date),
      to: cal.startOfDay(for: target)
    ).day
  }
}

struct CountdownProvider: TimelineProvider {
  func placeholder(in context: Context) -> CountdownEntry {
    CountdownEntry(date: Date(), title: "Trip", target: Date().addingTimeInterval(12 * 86_400))
  }

  func getSnapshot(in context: Context, completion: @escaping (CountdownEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : entry(on: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<CountdownEntry>) -> Void) {
    let cal = Calendar.current
    let today = cal.startOfDay(for: Date())
    var entries = [entry(on: Date())]
    for i in 1...7 {
      if let day = cal.date(byAdding: .day, value: i, to: today) {
        entries.append(entry(on: day))
      }
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }

  private func entry(on day: Date) -> CountdownEntry {
    let start = Calendar.current.startOfDay(for: day)
    let items = (SharedVault.state()["countdowns"] as? [[String: Any]]) ?? []
    let upcoming = items.compactMap { item -> (String, Date)? in
      guard let ms = item["date"] as? Double else { return nil }
      let title = (item["title"] as? String) ?? "Countdown"
      return (title, Date(timeIntervalSince1970: ms / 1000))
    }
    .filter { $0.1 >= start }
    .sorted { $0.1 < $1.1 }
    guard let next = upcoming.first else {
      return CountdownEntry(date: day, title: nil, target: nil)
    }
    return CountdownEntry(date: day, title: next.0, target: next.1)
  }
}

struct CountdownWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: CountdownEntry

  private var label: String {
    guard let n = entry.daysLeft else { return "" }
    if n == 0 { return "Today" }
    if n == 1 { return "Tomorrow" }
    return "\(n) days"
  }

  var body: some View {
    Group {
      if entry.title == nil {
        empty
      } else {
        switch family {
        case .accessoryInline:
          Text("\(entry.title ?? "") · \(label)")
        case .accessoryCircular:
          VStack(spacing: 0) {
            Text(entry.daysLeft.map { String($0) } ?? "–")
              .font(.system(size: 22, weight: .bold, design: .rounded))
              .minimumScaleFactor(0.5)
            Text("days").font(.caption2)
          }
        case .accessoryRectangular:
          VStack(alignment: .leading, spacing: 2) {
            Text(entry.title ?? "").font(.headline).lineLimit(1)
            Text(label).font(.system(.title3, design: .rounded).weight(.bold))
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        default:
          VStack(alignment: .leading, spacing: 4) {
            Text(entry.title ?? "")
              .font(.headline)
              .lineLimit(2)
            Spacer(minLength: 0)
            Text(entry.daysLeft.map { String($0) } ?? "–")
              .font(.system(size: 44, weight: .heavy, design: .rounded))
              .minimumScaleFactor(0.5)
              .foregroundStyle(.orange)
            Text(entry.daysLeft == 0 ? "today" : (entry.daysLeft == 1 ? "day to go" : "days to go"))
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .containerBackground(.fill.tertiary, for: .widget)
    .widgetURL(URL(string: "everytool://tool/days"))
  }

  @ViewBuilder private var empty: some View {
    switch family {
    case .accessoryInline:
      Text("No countdowns")
    case .accessoryCircular:
      Image(systemName: "calendar")
    default:
      VStack(alignment: .leading, spacing: 4) {
        Image(systemName: "calendar.badge.plus")
        Text("Add a countdown in Everytool → Days counter")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

struct CountdownWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "app.everytool.ios.widgets.countdown", provider: CountdownProvider()) {
      entry in
      CountdownWidgetView(entry: entry)
    }
    .configurationDisplayName("Countdown")
    .description("Days to go until your next saved countdown.")
    .supportedFamilies([
      .systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}
